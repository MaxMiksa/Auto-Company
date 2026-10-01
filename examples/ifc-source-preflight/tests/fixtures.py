"""独立构造 IFC 测试输入；人工数量无几何，不代表客户模型。"""
import uuid

import ifcopenshell
import ifcopenshell.guid


def guid(key):
    return ifcopenshell.guid.compress(uuid.uuid5(uuid.NAMESPACE_URL, "qa-ifc:" + key).hex)


def model(schema="IFC4", volume_prefix=None, length_prefix=None, project_volume=True):
    f = ifcopenshell.file(schema=schema)
    units = [f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE", Prefix=length_prefix)]
    if project_volume:
        units.append(f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE", Prefix=volume_prefix))
    assignment = f.create_entity("IfcUnitAssignment", Units=units)
    f.create_entity("IfcProject", GlobalId=guid("project"), Name="独立测试模型", UnitsInContext=assignment)
    return f


def element(f, key="a", kind="IfcWall", material="Concrete", name=None, identity=None):
    item = f.create_entity(kind, GlobalId=identity or guid(key), Name=name or key)
    if material is not None:
        mat = f.create_entity("IfcMaterial", Name=material)
        f.create_entity("IfcRelAssociatesMaterial", GlobalId=guid("mat:" + key), RelatedObjects=[item], RelatingMaterial=mat)
    return item


def volume(f, item, value=2.0, name="NetVolume", explicit=False, prefix=None, key="main"):
    unit = f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE", Prefix=prefix) if explicit else None
    quantity = f.create_entity("IfcQuantityVolume", Name=name, Unit=unit, VolumeValue=float(value))
    qset = f.create_entity("IfcElementQuantity", GlobalId=guid("qset:" + key), Name="Qto_TestQuantities", MethodOfMeasurement="QA-SAME-BASIS", Quantities=[quantity])
    f.create_entity("IfcRelDefinesByProperties", GlobalId=guid("rel:" + key), RelatedObjects=[item], RelatingPropertyDefinition=qset)
    return quantity, qset


def single(value=2.0, material="Concrete", **kwargs):
    f = model(**kwargs)
    item = element(f, material=material)
    if value is not None:
        volume(f, item, value)
    return f


def raw(f):
    return f.to_string()
