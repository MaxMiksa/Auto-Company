"""枚举 IFC 原始数量来源；完整性与已知小计分开，不推断采购量。"""
import hashlib
import math
import re
from collections import Counter

import ifcopenshell
import ifcopenshell.guid

MAX_FILE_BYTES = 10 * 1024 * 1024
PREFIX = {None: 1.0, 'EXA': 1e18, 'PETA': 1e15, 'TERA': 1e12,
          'GIGA': 1e9, 'MEGA': 1e6, 'KILO': 1e3, 'HECTO': 1e2,
          'DECA': 1e1, 'DECI': 1e-1, 'CENTI': 1e-2, 'MILLI': 1e-3,
          'MICRO': 1e-6, 'NANO': 1e-9, 'PICO': 1e-12, 'FEMTO': 1e-15,
          'ATTO': 1e-18}


class PreflightError(ValueError):
    """可向使用者展示的输入错误。"""


def raw_entity(value, seen=None):
    """保存原实体属性与引用，循环引用以 STEP ID 截断。"""
    seen = set() if seen is None else seen
    if isinstance(value, ifcopenshell.entity_instance):
        if value.id() in seen and value.id():
            return {'id': value.id(), 'type': value.is_a(), 'reference': True}
        branch = seen | {value.id()}
        return {key: raw_entity(item, branch) for key, item in value.get_info().items()}
    if isinstance(value, (tuple, list)):
        return [raw_entity(item, seen) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def volume_factor(unit, seen=None):
    seen = set() if seen is None else seen
    if unit is None or unit.id() in seen or getattr(unit, 'UnitType', None) != 'VOLUMEUNIT':
        return None
    seen = seen | {unit.id()}
    if unit.is_a('IfcSIUnit'):
        if unit.Name != 'CUBIC_METRE' or unit.Prefix not in PREFIX:
            return None
        return PREFIX[unit.Prefix] ** 3
    if unit.is_a('IfcConversionBasedUnit'):
        # 带偏移的单位不适用于本产品的体积换算。
        if unit.is_a('IfcConversionBasedUnitWithOffset') and unit.ConversionOffset != 0:
            return None
        dimensions = unit.Dimensions
        if dimensions is None or tuple(dimensions) != (3, 0, 0, 0, 0, 0, 0):
            return None
        conversion = unit.ConversionFactor
        factor = volume_factor(conversion.UnitComponent, seen)
        value = conversion.ValueComponent.wrappedValue
        if factor is None or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            return None
        result = factor * value
        return result if math.isfinite(result) and result > 0 else None
    return None


def relation_snapshot(relation):
    """关系的直接属性原值；对象引用保留 ID，不递归复制几何模型。"""
    def reference(value):
        if isinstance(value, ifcopenshell.entity_instance):
            return {'id': value.id(), 'type': value.is_a()}
        if isinstance(value, (tuple, list)):
            return [reference(item) for item in value]
        return value
    return {key: reference(value) for key, value in relation.get_info().items()}


def material_info(element, types):
    associations = []
    scope = 'occurrence'
    for relation in getattr(element, 'HasAssociations', ()) or ():
        if relation.is_a('IfcRelAssociatesMaterial'):
            associations.append(relation)
    if not associations:
        scope = 'type'
        for type_entity, _ in types:
            for relation in getattr(type_entity, 'HasAssociations', ()) or ():
                if relation.is_a('IfcRelAssociatesMaterial'):
                    associations.append(relation)
    entities = [relation.RelatingMaterial for relation in associations]
    raw = [{'scope': scope, 'relation_entity': relation.id(),
            'value': raw_entity(relation.RelatingMaterial)} for relation in associations]
    if len(entities) == 1 and entities[0].is_a('IfcMaterial') and entities[0].Name:
        return entities[0].Name, entities[0].id(), raw
    return None, entities[0].id() if len(entities) == 1 else None, raw


def element_types(element):
    result = []
    for relation in (list(getattr(element, 'IsTypedBy', ()) or ()) +
                     list(getattr(element, 'IsDefinedBy', ()) or ())):
        if relation.is_a('IfcRelDefinesByType'):
            pair = (relation.RelatingType, relation)
            if pair not in result:
                result.append(pair)
    return result


def quantity_sets(element, types):
    for relation in getattr(element, 'IsDefinedBy', ()) or ():
        if relation.is_a('IfcRelDefinesByProperties'):
            definition = relation.RelatingPropertyDefinition
            definitions = definition if isinstance(definition, tuple) else (definition,)
            for qset in definitions:
                if qset.is_a('IfcElementQuantity'):
                    yield qset, 'occurrence', relation.id(), None
    for type_entity, relation in types:
        for qset in getattr(type_entity, 'HasPropertySets', ()) or ():
            if qset.is_a('IfcElementQuantity'):
                yield qset, 'type', relation.id(), type_entity.id()


def walk_quantities(quantities):
    for quantity in quantities or ():
        yield quantity
        if quantity.is_a('IfcPhysicalComplexQuantity'):
            yield from walk_quantities(quantity.HasQuantities)


def _parse_version(content, name, version, element_type, quantity_name):
    if not isinstance(content, str) or not content.strip():
        raise PreflightError(f'{name}：文件为空，请选择 IFC STEP 文件。')
    if len(content.encode('utf-8')) > MAX_FILE_BYTES:
        raise PreflightError(f'{name}：单文件超过 10 MB，请导出较小的复核范围。')
    if not content.lstrip('\ufeff \t\r\n').startswith('ISO-10303-21;') or 'END-ISO-10303-21;' not in content:
        raise PreflightError(f'{name}：仅支持完整的 IFC2X3 / IFC4 STEP 文本文件，不支持 IFCZIP 或二进制文件。')
    try:
        model = ifcopenshell.file.from_string(content.lstrip('\ufeff'))
    except Exception as exc:
        raise PreflightError(f'{name}：IFC 解析失败，请检查文件是否损坏或重新导出。') from exc
    if model.schema not in ('IFC2X3', 'IFC4'):
        raise PreflightError(f'{name}：当前支持 IFC2X3 和 IFC4，该文件为 {model.schema}。')
    try:
        elements = model.by_type(element_type)
        # 用户筛选必须是 IfcElement 子类，而非任意模型实体。
        schema = ifcopenshell.ifcopenshell_wrapper.schema_by_name(model.schema)
        declaration = schema.declaration_by_name(element_type)
        while declaration and declaration.name() != 'IfcElement':
            declaration = declaration.supertype()
        if declaration is None:
            raise ValueError()
    except Exception as exc:
        raise PreflightError(f'{name}：对象类型必须是该 IFC 版本中的 IfcElement 或其子类。') from exc
    sources, issues, objects = [], [], []
    project_units = []
    for project in model.by_type('IfcProject'):
        assignment = project.UnitsInContext
        if assignment:
            project_units.extend(unit for unit in assignment.Units if getattr(unit, 'UnitType', None) == 'VOLUMEUNIT')
    # 同一实体被多个项目共享不构成多单位。
    project_units = list({unit.id(): unit for unit in project_units}.values())
    guid_counts = Counter(getattr(element, 'GlobalId', None) for element in elements)

    def valid_guid(guid):
        if not isinstance(guid, str) or not re.fullmatch(r'[0-3][0-9A-Za-z_$]{21}', guid):
            return False
        try:
            return ifcopenshell.guid.compress(ifcopenshell.guid.expand(guid)) == guid
        except Exception:
            return False

    def issue(element, code, message, severity='error'):
        issues.append({'version': version, 'code': code, 'severity': severity,
                       'guid': element.GlobalId, 'element_entity': element.id(), 'message': message})

    if not elements:
        issues.append({'version': version, 'code': 'empty-selection', 'severity': 'error',
                       'guid': None, 'element_entity': None, 'message': '筛选范围没有对象；请检查对象类型，空范围不视为完整。'})
    for element in elements:
        types = element_types(element)
        material, material_id, material_raw = material_info(element, types)
        if not element.GlobalId:
            issue(element, 'missing-guid', '对象缺少 GUID，无法可靠对应版本身份。', 'warning')
        elif not valid_guid(element.GlobalId):
            issue(element, 'invalid-guid', 'GUID 格式无效，保留对象原值但不能可靠对应版本身份。', 'warning')
        elif guid_counts[element.GlobalId] > 1:
            issue(element, 'duplicate-guid', '同版 GUID 重复，保留各实体，停止按该 GUID 匹配。', 'warning')
        if material is None:
            issue(element, 'complex-material' if material_raw else 'missing-material',
                  '材料为多来源或层/组/复合结构，保留原材料定义，不分摊体积。' if material_raw else '对象缺少可明确归属的单一材料；数量小计仍可独立复核。', 'warning')
        rows = []
        for qset, scope, relation_id, type_id in quantity_sets(element, types):
            for quantity in walk_quantities(qset.Quantities):
                selected = quantity.Name == quantity_name
                is_volume = quantity.is_a('IfcQuantityVolume')
                raw_value = quantity.VolumeValue if is_volume else None
                explicit = getattr(quantity, 'Unit', None)
                unit = explicit if explicit is not None else project_units[0] if len(project_units) == 1 else None
                factor = volume_factor(unit) if is_volume else None
                numeric_valid = isinstance(raw_value, (int, float)) and math.isfinite(raw_value) and raw_value >= 0
                converted = raw_value * factor if numeric_valid and factor is not None else None
                if converted is not None and not math.isfinite(converted):
                    converted = None
                row = {'version': version, 'element_entity': element.id(), 'element_type': element.is_a(),
                       'guid': element.GlobalId, 'name': element.Name, 'tag': getattr(element, 'Tag', None),
                       'scope': scope, 'relation_entity': relation_id, 'type_entity': type_id,
                       'relation_raw': relation_snapshot(model.by_id(relation_id)),
                       'qset_entity': qset.id(), 'qset_guid': qset.GlobalId, 'qset_name': qset.Name,
                       'qset_raw': raw_entity(qset),
                       'measurement_basis': qset.MethodOfMeasurement, 'quantity_entity': quantity.id(),
                       'quantity_name': quantity.Name, 'quantity_type': quantity.is_a(), 'selected': selected,
                       'quantity_raw': raw_entity(quantity), 'raw_value': raw_value if not isinstance(raw_value, float) or math.isfinite(raw_value) else str(raw_value),
                       'unit_origin': 'quantity-explicit' if explicit is not None else 'project-volume',
                       'unit_entity': unit.id() if unit else None, 'unit_name': getattr(unit, 'Name', None),
                       'unit_prefix': getattr(unit, 'Prefix', None), 'unit_raw': raw_entity(unit),
                       'project_unit_candidates': [raw_entity(item) for item in project_units] if explicit is None else [],
                       'factor_to_m3': factor, 'value_m3': converted, 'material': material,
                       'material_entity': material_id, 'material_raw': material_raw,
                       'status': '有效来源' if converted is not None else '未解析'}
                sources.append(row)
                if selected:
                    rows.append(row)
                    if not is_volume:
                        issue(element, 'wrong-quantity-type', '选定名称对应非体积数量实体，不能换算为 m³。')
                    elif not numeric_valid:
                        issue(element, 'invalid-value', '体积为负值或非有限数字，不能计入已知小计。')
                    elif factor is None:
                        issue(element, 'unknown-unit', '缺少唯一可换算的体积单位，保留原值；不使用长度单位推定体积。')
                    elif converted is None:
                        issue(element, 'invalid-value', '体积换算溢出，不能计入已知小计。')
        if not rows:
            issue(element, 'missing-quantity', f'对象缺少 {quantity_name} 数量来源，请补齐或调整字段。')
        elif len(rows) > 1:
            issue(element, 'multiple-sources', '对象存在多个同名数量来源（含实例/类型来源），不静默选取或相加；请确认口径。')
            for row in rows:
                row['status'] = '多来源待复核'
        value = rows[0]['value_m3'] if len(rows) == 1 else None
        objects.append({'guid': element.GlobalId, 'entity': element.id(), 'name': element.Name,
                        'element_type': element.is_a(), 'value_m3': value, 'material': material,
                        'material_raw': material_raw, 'identity_valid': valid_guid(element.GlobalId) and guid_counts[element.GlobalId] == 1})
    resolved = [obj for obj in objects if obj['value_m3'] is not None]
    try:
        subtotal = math.fsum(obj['value_m3'] for obj in resolved)
    except OverflowError as exc:
        raise PreflightError(f'{name}：已知数量小计溢出，请缩小范围或检查极大数量。') from exc
    if not math.isfinite(subtotal):
        raise PreflightError(f'{name}：已知数量小计溢出，请缩小范围或检查极大数量。')
    resolved_ids = {obj['entity'] for obj in resolved}
    overlap_ids = set()
    descendants = {}
    for relation_name in ('IfcRelAggregates', 'IfcRelNests'):
        for relation in model.by_type(relation_name):
            parent = relation.RelatingObject
            if parent is not None:
                descendants.setdefault(parent.id(), set()).update(child.id() for child in relation.RelatedObjects or () if child is not None)
    for parent_id in resolved_ids:
        pending = list(descendants.get(parent_id, ()))
        seen = set()
        while pending:
            child_id = pending.pop()
            if child_id in seen:
                continue
            seen.add(child_id)
            if child_id in resolved_ids:
                overlap_ids.update((parent_id, child_id))
            pending.extend(descendants.get(child_id, ()))
    for element in elements:
        if element.id() in overlap_ids:
            issue(element, 'aggregate-overlap', '选中范围同时包含有数量的总成和子件，可能重复计量；保留原值但不确认完整合计。')
    for row in sources:
        if row['element_entity'] in overlap_ids and row['selected']:
            row['status'] = '总成/子件口径待复核'
    quantity_complete = (bool(objects) and len(resolved) == len(objects) and
                         not overlap_ids and not any(guid and count > 1 for guid, count in guid_counts.items()))
    stats = {'name': name, 'schema': model.schema, 'object_count': len(objects), 'source_count': len(sources),
             'resolved_count': len(resolved), 'known_subtotal_m3': subtotal,
             'identity_complete': all(obj['identity_valid'] for obj in objects),
             'quantity_complete': quantity_complete,
             'material_complete': quantity_complete and all(obj['material'] is not None for obj in objects),
             'sha256': hashlib.sha256(content.encode('utf-8')).hexdigest()}
    return stats, sources, issues, objects


def parse_version(content, name, version, element_type, quantity_name):
    try:
        return _parse_version(content, name, version, element_type, quantity_name)
    except PreflightError:
        raise
    except Exception as exc:
        raise PreflightError(f'{name}：IFC 来源包含损坏引用或不可解析属性，请重新导出后重试；未生成差量结论。') from exc


def analyze(old_content, new_content, old_name='旧版.ifc', new_name='新版.ifc',
            element_type='IfcElement', quantity_name='NetVolume'):
    if not isinstance(element_type, str) or not element_type or len(element_type) > 80:
        raise PreflightError('请输入有效的 IFC 对象类型。')
    if not isinstance(quantity_name, str) or not quantity_name.strip() or len(quantity_name) > 120:
        raise PreflightError('请输入有效的体积数量字段名称。')
    parsed = {version: parse_version(content, name, version, element_type, quantity_name)
              for version, content, name in [('old', old_content, old_name), ('new', new_content, new_name)]}
    old, new = parsed['old'][0], parsed['new'][0]
    sources = parsed['old'][1] + parsed['new'][1]
    issues = parsed['old'][2] + parsed['new'][2]
    old_objects, new_objects = parsed['old'][3], parsed['new'][3]
    quantity_complete = old['quantity_complete'] and new['quantity_complete']
    material_complete = old['material_complete'] and new['material_complete']
    basis_by_version = {version: {row['measurement_basis'] for row in parsed[version][1] if row['selected']}
                        for version in ('old', 'new')}
    known_bases = {basis for bases in basis_by_version.values() for basis in bases if basis}
    if any(None in bases or '' in bases for bases in basis_by_version.values()):
        issues.append({'version': 'both', 'code': 'unknown-measurement-basis', 'severity': 'warning',
                       'guid': None, 'element_entity': None,
                       'message': '部分数量来源未声明计量方法；相同字段名称不证明采购计量口径相同，需专业复核。'})
    comparison_complete = quantity_complete
    if len(known_bases) > 1 or (basis_by_version['old'] != basis_by_version['new']):
        comparison_complete = False
        issues.append({'version': 'both', 'code': 'basis-change', 'severity': 'error',
                       'guid': None, 'element_entity': None,
                       'message': '版本间或选中范围内计量方法不同，已知子集变化仍保留，完整差量停止确认。'})
    if old['schema'] != new['schema']:
        comparison_complete = False
        issues.append({'version': 'both', 'code': 'schema-mismatch', 'severity': 'warning',
                       'guid': None, 'element_entity': None,
                       'message': '两版 IFC schema 不同，请确认导出与计量口径；仅保留已知来源，不确认完整差量。'})
    old_index = {obj['guid']: obj for obj in old_objects if obj['identity_valid']}
    new_index = {obj['guid']: obj for obj in new_objects if obj['identity_valid']}
    old_only, new_only = set(old_index) - set(new_index), set(new_index) - set(old_index)
    if old_only and new_only:
        issues.append({'version': 'both', 'code': 'identity-unresolved', 'severity': 'warning',
                       'guid': None, 'element_entity': None,
                       'message': '两版均存在未匹配 GUID，可能是新增/移除或 GUID 重建；不凭名称、Tag 或数量猜配。'})
    objects = []

    def pair(guid, before, after, status):
        before_value = before['value_m3'] if before else None
        after_value = after['value_m3'] if after else None
        objects.append({'guid': guid, 'status': status,
                        'old_entity': before['entity'] if before else None, 'new_entity': after['entity'] if after else None,
                        'old_name': before['name'] if before else None, 'new_name': after['name'] if after else None,
                        'old_value_m3': before_value, 'new_value_m3': after_value,
                        'delta_m3': after_value - before_value if before_value is not None and after_value is not None and len(known_bases) <= 1 and old['schema'] == new['schema'] and basis_by_version['old'] == basis_by_version['new'] else None,
                        'old_material': before['material'] if before else None,
                        'new_material': after['material'] if after else None})
    for guid in sorted(set(old_index) | set(new_index)):
        before, after = old_index.get(guid), new_index.get(guid)
        status = 'GUID 对应' if before and after else '新版未匹配' if after else '旧版未匹配'
        pair(guid, before, after, status)
    for version, version_objects in [('old', old_objects), ('new', new_objects)]:
        for obj in version_objects:
            if not obj['identity_valid']:
                pair(obj['guid'], obj if version == 'old' else None, obj if version == 'new' else None, '身份待复核')
    material_totals = {}
    for version, version_objects in [('old', old_objects), ('new', new_objects)]:
        for obj in version_objects:
            if obj['material'] is not None and obj['value_m3'] is not None:
                material_totals.setdefault(obj['material'], {'old': [], 'new': []})[version].append(obj['value_m3'])
    materials = []
    for material, totals in sorted(material_totals.items()):
        before, after = math.fsum(totals['old']), math.fsum(totals['new'])
        materials.append({'material': material, 'old_known_m3': before, 'new_known_m3': after,
                          'known_delta_m3': after - before,
                          'complete_delta_m3': after - before if material_complete and comparison_complete else None})
    delta = new['known_subtotal_m3'] - old['known_subtotal_m3']
    return {'schema_version': 1, 'selection': {'element_type': element_type, 'quantity_name': quantity_name, 'unit': 'm³'},
            'versions': {'old': old, 'new': new},
            'summary': {'quantity_complete': quantity_complete, 'material_complete': material_complete,
                        'identity_complete': old['identity_complete'] and new['identity_complete'] and not old_only and not new_only,
                        'comparison_complete': comparison_complete,
                        'known_delta_m3': delta, 'complete_delta_m3': delta if comparison_complete else None,
                        'issue_count': len(issues)},
            'sources': sources, 'issues': issues, 'materials': materials, 'objects': objects,
            'notice': '模型数量不等于采购量。本工具读取已导出的数量来源，不计算几何、不分摊复合材料、不证明采购正确性；已知子集变化不代表完整差量。总成/子件或重复 GUID 等问题存在时，已知小计仍可能含重叠候选量，必须复核。'}
