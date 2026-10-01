import unittest
from pathlib import Path

from preflight import MAX_FILE_BYTES, PreflightError, analyze
from tests.fixtures import element, guid, model, raw, single, volume


def compare(before, after, **kwargs):
    return analyze(raw(before), raw(after), **kwargs)


def codes(report):
    return {item['code'] for item in report['issues']}


class CoreFlowTests(unittest.TestCase):
    def test_original_frozen_scenarios_regression(self):
        root = Path(__file__).resolve().parents[1] / 'examples'
        expected = {'normal': 1, 'swap': 0, 'material-only': 0, 'units': 0,
                    'missing': None, 'source-conflict': None, 'guid-rebuilt': 1,
                    'ambiguous': 0, 'name-only': 0, 'unchanged': 0}
        for case, delta in expected.items():
            with self.subTest(case=case):
                report = analyze((root / case / 'old.ifc').read_text(encoding='utf-8'), (root / case / 'new.ifc').read_text(encoding='utf-8'))
                self.assertEqual(report['summary']['complete_delta_m3'], delta)
                self.assertGreater(len(report['sources']), 0)
                if case == 'swap':
                    self.assertEqual({r['material']: r['complete_delta_m3'] for r in report['materials']}, {'Concrete': 1, 'Steel': -1})

    def test_real_sources_and_known_delta(self):
        old, new = single(2), single(3)
        report = compare(old, new)
        self.assertEqual(report['summary']['complete_delta_m3'], 1)
        self.assertTrue(report['summary']['material_complete'])
        self.assertEqual(report['materials'][0]['complete_delta_m3'], 1)
        self.assertEqual(report['objects'][0]['delta_m3'], 1)
        self.assertEqual(len(report['sources']), 2)
        for version, f in [('old', old), ('new', new)]:
            source = next(row for row in report['sources'] if row['version'] == version)
            self.assertEqual(source['qset_entity'], f.by_type('IfcElementQuantity')[0].id())
            self.assertEqual(source['quantity_entity'], f.by_type('IfcQuantityVolume')[0].id())
            self.assertEqual(source['raw_value'], 2 if version == 'old' else 3)
            self.assertEqual(source['quantity_raw']['type'], 'IfcQuantityVolume')
            self.assertEqual(source['unit_origin'], 'project-volume')
            self.assertEqual(source['factor_to_m3'], 1)

    def test_explicit_volume_overrides_millimetre_length(self):
        before = single(2)
        after = model(length_prefix='MILLI')
        wall = element(after)
        volume(after, wall, 2, explicit=True)
        report = compare(before, after)
        self.assertEqual(report['summary']['complete_delta_m3'], 0)
        self.assertEqual(report['sources'][1]['unit_origin'], 'quantity-explicit')
        self.assertEqual(report['sources'][1]['value_m3'], 2)

    def test_project_cubic_millimetres(self):
        report = compare(single(2), single(2_000_000_000, volume_prefix='MILLI'))
        self.assertAlmostEqual(report['summary']['complete_delta_m3'], 0)
        self.assertAlmostEqual(report['sources'][1]['factor_to_m3'], 1e-9)

    def test_conversion_based_volume(self):
        after = single(70.629333442977)
        metres = after.by_type('IfcSIUnit')[1]
        factor = after.create_entity('IfcMeasureWithUnit', ValueComponent=after.create_entity('IfcVolumeMeasure', 0.028316846592), UnitComponent=metres)
        dimensions = after.create_entity('IfcDimensionalExponents', LengthExponent=3, MassExponent=0, TimeExponent=0, ElectricCurrentExponent=0, ThermodynamicTemperatureExponent=0, AmountOfSubstanceExponent=0, LuminousIntensityExponent=0)
        feet = after.create_entity('IfcConversionBasedUnit', Dimensions=dimensions, UnitType='VOLUMEUNIT', Name='cubic foot', ConversionFactor=factor)
        after.by_type('IfcQuantityVolume')[0].Unit = feet
        report = compare(single(2), after)
        self.assertAlmostEqual(report['summary']['complete_delta_m3'], 0, places=9)

    def test_material_transfer_is_not_zeroed_by_equal_total(self):
        report = compare(single(2, 'Concrete'), single(2, 'Timber'))
        self.assertEqual(report['summary']['complete_delta_m3'], 0)
        material = {row['material']: row['complete_delta_m3'] for row in report['materials']}
        self.assertEqual(material, {'Concrete': -2, 'Timber': 2})

    def test_all_element_subclasses_and_selected_range(self):
        before, after = model(), model()
        for kind, value in [('IfcWall', 2), ('IfcSlab', 4), ('IfcBeam', 8), ('IfcBuildingElementProxy', 16)]:
            for f, change in [(before, 0), (after, 1)]:
                wall = element(f, kind, kind=kind)
                volume(f, wall, value + change, key=kind)
        all_report = compare(before, after)
        self.assertEqual(all_report['versions']['old']['object_count'], 4)
        self.assertEqual(all_report['summary']['complete_delta_m3'], 4)
        beam_report = compare(before, after, element_type='IfcBeam')
        self.assertEqual(beam_report['versions']['old']['object_count'], 1)
        self.assertEqual(beam_report['summary']['complete_delta_m3'], 1)

    def test_ifc2x3_and_ifc4_versions(self):
        for schema in ['IFC2X3', 'IFC4']:
            with self.subTest(schema=schema):
                report = compare(single(2, schema=schema), single(3, schema=schema))
                self.assertEqual(report['versions']['old']['schema'], schema)
                self.assertEqual(report['summary']['complete_delta_m3'], 1)

    def test_type_quantities_are_enumerated(self):
        f = model()
        wall = element(f, material=None)
        quantity = f.create_entity('IfcQuantityVolume', Name='NetVolume', VolumeValue=2.0)
        qset = f.create_entity('IfcElementQuantity', GlobalId=guid('type-qset'), Name='TypeQuantities', Quantities=[quantity])
        wall_type = f.create_entity('IfcWallType', GlobalId=guid('wall-type'), Name='类型墙', HasPropertySets=[qset], PredefinedType='NOTDEFINED')
        f.create_entity('IfcRelDefinesByType', GlobalId=guid('type-rel'), RelatedObjects=[wall], RelatingType=wall_type)
        material = f.create_entity('IfcMaterial', Name='TypeConcrete')
        f.create_entity('IfcRelAssociatesMaterial', GlobalId=guid('type-material'), RelatedObjects=[wall_type], RelatingMaterial=material)
        report = compare(f, f)
        self.assertEqual(report['summary']['complete_delta_m3'], 0)
        row = report['sources'][0]
        self.assertEqual(row['scope'], 'type')
        self.assertEqual(row['type_entity'], wall_type.id())
        self.assertEqual(row['material'], 'TypeConcrete')

    def test_unselected_quantity_sources_remain_in_bottom_sheet(self):
        f = single(2)
        volume(f, f.by_type('IfcWall')[0], 9, name='GrossVolume', key='gross')
        report = compare(f, f)
        self.assertEqual(report['summary']['complete_delta_m3'], 0)
        self.assertEqual(len(report['sources']), 4)
        self.assertEqual(sum(row['selected'] for row in report['sources']), 2)

    def test_nested_physical_quantity_preserves_container_and_leaf(self):
        f = model()
        wall = element(f)
        leaf = f.create_entity('IfcQuantityVolume', Name='NetVolume', VolumeValue=2.0)
        container = f.create_entity('IfcPhysicalComplexQuantity', Name='Nested', HasQuantities=[leaf], Discrimination='synthetic')
        qset = f.create_entity('IfcElementQuantity', GlobalId=guid('nested-qset'), Name='NestedSet', MethodOfMeasurement='QA-SAME-BASIS', Quantities=[container])
        f.create_entity('IfcRelDefinesByProperties', GlobalId=guid('nested-rel'), RelatedObjects=[wall], RelatingPropertyDefinition=qset)
        report = compare(f, f)
        self.assertEqual(report['summary']['complete_delta_m3'], 0)
        self.assertEqual(len(report['sources']), 4)
        self.assertEqual(sum(row['selected'] for row in report['sources']), 2)
        self.assertEqual({row['quantity_type'] for row in report['sources']}, {'IfcPhysicalComplexQuantity', 'IfcQuantityVolume'})


class FailureRecoveryTests(unittest.TestCase):
    def assert_incomplete(self, report, code):
        self.assertIn(code, codes(report))
        self.assertIsNone(report['summary']['complete_delta_m3'])
        self.assertTrue(all(row['complete_delta_m3'] is None for row in report['materials']))

    def test_missing_quantity_does_not_become_definite_deletion(self):
        report = compare(single(2), single(None))
        self.assert_incomplete(report, 'missing-quantity')
        self.assertEqual(report['summary']['known_delta_m3'], -2)
        self.assertIsNone(report['objects'][0]['delta_m3'])

    def test_conflicting_sources_keep_every_original_value(self):
        f = single(3)
        volume(f, f.by_type('IfcWall')[0], 7, key='second')
        report = compare(single(2), f)
        self.assert_incomplete(report, 'multiple-sources')
        self.assertEqual([row['raw_value'] for row in report['sources'] if row['version'] == 'new'], [3, 7])
        self.assertEqual(len({row['quantity_entity'] for row in report['sources'] if row['version'] == 'new'}), 2)

    def test_equal_duplicate_sources_are_still_not_silently_chosen(self):
        f = single(2)
        volume(f, f.by_type('IfcWall')[0], 2, key='second')
        self.assert_incomplete(compare(f, f), 'multiple-sources')

    def test_missing_volume_unit_does_not_cube_length_unit(self):
        f = single(2, length_prefix='MILLI', project_volume=False)
        report = compare(single(2), f)
        self.assert_incomplete(report, 'unknown-unit')
        self.assertEqual(report['sources'][1]['raw_value'], 2)
        self.assertIsNone(report['sources'][1]['value_m3'])

    def test_wrong_quantity_type_and_negative_value(self):
        f = single(-2)
        self.assert_incomplete(compare(single(2), f), 'invalid-value')
        f = model()
        wall = element(f)
        q = f.create_entity('IfcQuantityLength', Name='NetVolume', LengthValue=4.0)
        qset = f.create_entity('IfcElementQuantity', GlobalId=guid('wrong-set'), Name='WrongType', Quantities=[q])
        f.create_entity('IfcRelDefinesByProperties', GlobalId=guid('wrong-rel'), RelatedObjects=[wall], RelatingPropertyDefinition=qset)
        self.assert_incomplete(compare(single(2), f), 'wrong-quantity-type')

    def test_complex_material_retained_and_never_split_arbitrarily(self):
        f = single(2, material=None)
        wall = f.by_type('IfcWall')[0]
        mats = [f.create_entity('IfcMaterial', Name=name) for name in ['Concrete', 'Steel']]
        layers = [f.create_entity('IfcMaterialLayer', Material=mat, LayerThickness=0.1) for mat in mats]
        layer_set = f.create_entity('IfcMaterialLayerSet', MaterialLayers=layers, LayerSetName='复合材料')
        f.create_entity('IfcRelAssociatesMaterial', GlobalId=guid('complex-rel'), RelatedObjects=[wall], RelatingMaterial=layer_set)
        report = compare(f, f)
        self.assertIn('complex-material', codes(report))
        self.assertFalse(report['summary']['material_complete'])
        self.assertEqual(report['materials'], [])
        self.assertEqual(report['sources'][0]['material_raw'][0]['value']['type'], 'IfcMaterialLayerSet')

    def test_duplicate_guid_keeps_entities_without_false_pairing(self):
        f = single(2)
        duplicate = element(f, 'dup', identity=f.by_type('IfcWall')[0].GlobalId)
        volume(f, duplicate, 5, key='dup')
        report = compare(f, f)
        self.assertIn('duplicate-guid', codes(report))
        self.assertEqual(len(report['sources']), 4)
        self.assertTrue(all(row['delta_m3'] is None for row in report['objects']))
        self.assertIsNone(report['summary']['complete_delta_m3'])

    def test_rebuilt_guid_not_guessed_from_names_or_quantities(self):
        before, after = single(2), single(2)
        after.by_type('IfcWall')[0].GlobalId = guid('rebuilt')
        report = compare(before, after)
        self.assertIn('identity-unresolved', codes(report))
        self.assertEqual(len(report['objects']), 2)
        self.assertTrue(all(row['delta_m3'] is None for row in report['objects']))

    def test_empty_scope_cannot_be_complete(self):
        self.assert_incomplete(compare(single(), single(), element_type='IfcBeam'), 'empty-selection')

    def test_parent_and_child_quantities_are_not_double_counted_as_complete(self):
        f = single(5)
        parent = f.by_type('IfcWall')[0]
        child = element(f, 'part', kind='IfcBuildingElementPart')
        volume(f, child, 5, key='child')
        f.create_entity('IfcRelAggregates', GlobalId=guid('aggregate'), RelatingObject=parent, RelatedObjects=[child])
        report = compare(f, f)
        self.assert_incomplete(report, 'aggregate-overlap')
        self.assertEqual(len(report['sources']), 4)

    def test_indirect_aggregate_overlap_through_unquantified_container(self):
        f = single(5)
        parent = f.by_type('IfcWall')[0]
        middle = element(f, 'middle', kind='IfcBuildingElementPart')
        leaf = element(f, 'leaf', kind='IfcBuildingElementPart')
        volume(f, leaf, 5, key='leaf')
        f.create_entity('IfcRelAggregates', GlobalId=guid('parent-middle'), RelatingObject=parent, RelatedObjects=[middle])
        f.create_entity('IfcRelAggregates', GlobalId=guid('middle-leaf'), RelatingObject=middle, RelatedObjects=[leaf])
        report = compare(f, f)
        self.assert_incomplete(report, 'aggregate-overlap')
        self.assertIn('missing-quantity', codes(report))

    def test_missing_guid_retains_sources_without_pairing(self):
        f = single(2)
        f.by_type('IfcWall')[0].GlobalId = None
        report = compare(f, f)
        self.assertIn('missing-guid', codes(report))
        self.assertFalse(report['summary']['identity_complete'])
        self.assertEqual(report['summary']['complete_delta_m3'], 0)
        self.assertEqual(len(report['sources']), 2)
        self.assertTrue(all(row['delta_m3'] is None for row in report['objects']))

    def test_invalid_guid_does_not_create_object_correspondence(self):
        f = single(2)
        f.by_type('IfcWall')[0].GlobalId = 'INVALID-GUID'
        report = compare(f, f)
        self.assertIn('invalid-guid', codes(report))
        self.assertFalse(report['summary']['identity_complete'])
        self.assertTrue(all(row['delta_m3'] is None for row in report['objects']))

    def test_measurement_basis_change_is_not_certified_comparable(self):
        before, after = single(2), single(3)
        after.by_type('IfcElementQuantity')[0].MethodOfMeasurement = 'OTHER-BASIS'
        report = compare(before, after)
        self.assert_incomplete(report, 'basis-change')

    def test_bad_and_oversized_input_then_successful_retry(self):
        valid = raw(single())
        bad_inputs = ['', 'not an IFC', valid.replace('END-ISO-10303-21;', ''), 'x' * (MAX_FILE_BYTES + 1)]
        for content in bad_inputs:
            with self.subTest(size=len(content)):
                with self.assertRaises(PreflightError) as failure:
                    analyze(content, valid)
                self.assertTrue(any('\u4e00' <= c <= '\u9fff' for c in str(failure.exception)))
        self.assertEqual(analyze(valid, valid)['summary']['complete_delta_m3'], 0)

    def test_invalid_filters_are_rejected(self):
        valid = raw(single())
        for kwargs in [{'element_type': 'IfcProject'}, {'element_type': 'NotAnIfcClass'}, {'element_type': None}, {'quantity_name': ''}, {'quantity_name': 'x' * 121}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(PreflightError):
                analyze(valid, valid, **kwargs)

    def test_cross_schema_keeps_known_change_without_certifying_basis(self):
        report = compare(single(2, schema='IFC2X3'), single(3, schema='IFC4'))
        self.assert_incomplete(report, 'schema-mismatch')
        self.assertEqual(report['summary']['known_delta_m3'], 1)


if __name__ == '__main__':
    unittest.main()
