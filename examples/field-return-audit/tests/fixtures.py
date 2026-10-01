"""Independent synthetic GeoPackage fixtures; no evaluated artifacts are reused."""

import base64
import copy
import hashlib
import sqlite3
import struct
import tempfile
from pathlib import Path


def geometry(x, y):
    # GeoPackage binary header, little endian WKB POINT, EPSG:4326.
    return b"GP\x00\x01" + struct.pack("<i", 4326) + struct.pack("<BIdd", 1, 1, x, y)


def database(rows, visits, *, gpkg=True):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "synthetic.gpkg"
        db = sqlite3.connect(path)
        db.executescript("""
            CREATE TABLE sites(uid TEXT PRIMARY KEY, name TEXT, team TEXT, geom BLOB, photo TEXT);
            CREATE TABLE visits(uid TEXT PRIMARY KEY, site_uid TEXT, note TEXT);
        """)
        db.executemany("INSERT INTO sites VALUES(?,?,?,?,?)", rows)
        db.executemany("INSERT INTO visits VALUES(?,?,?)", visits)
        if gpkg:
            db.executescript("""
                PRAGMA application_id=1196444487;
                PRAGMA user_version=10300;
                CREATE TABLE gpkg_spatial_ref_sys(srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY,
                    organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
                INSERT INTO gpkg_spatial_ref_sys VALUES('WGS 84',4326,'EPSG',4326,'GEOGCS["WGS 84"]','synthetic fixture');
                CREATE TABLE gpkg_contents(table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
                    identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT '2026-10-01T00:00:00.000Z',
                    min_x DOUBLE,min_y DOUBLE,max_x DOUBLE,max_y DOUBLE,srs_id INTEGER);
                INSERT INTO gpkg_contents(table_name,data_type,identifier,srs_id) VALUES('sites','features','sites',4326);
                CREATE TABLE gpkg_geometry_columns(table_name TEXT NOT NULL,column_name TEXT NOT NULL,
                    geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,
                    PRIMARY KEY(table_name,column_name));
                INSERT INTO gpkg_geometry_columns VALUES('sites','geom','POINT',4326,0,0);
            """)
        db.commit()
        db.close()
        return path.read_bytes()


def uploaded(name, data):
    return {"name": name, "data": base64.b64encode(data).decode("ascii")}


def attachment(path, data):
    return {"path": path, "data": base64.b64encode(data).decode("ascii")}


def payload():
    baseline = database([
        ("s1", "原名称", "office", geometry(120, 30), "photos/a.jpg"),
        ("s2", "待删除", "office", geometry(121, 31), "photos/b.jpg"),
    ], [("v1", "s1", "基线备注"), ("v2", "s2", "旧记录")])
    field = database([
        ("s1", "现场名称", "office", geometry(120.1, 30.2), "photos/a.jpg"),
        ("s3", "新增点", "field", geometry(122, 32), "photos/c.jpg"),
    ], [("v1", "s1", "现场备注"), ("v3", "s3", "新增访问")])
    attachments = [attachment("photos/a.jpg", b"synthetic photo A"), attachment("photos/c.jpg", b"synthetic photo C")]
    return {
        "baseline": uploaded("departure.gpkg", baseline),
        "field": uploaded("field.gpkg", field),
        "target": uploaded("master.gpkg", field),
        "field_attachments": copy.deepcopy(attachments),
        "target_attachments": copy.deepcopy(attachments),
        "config": {
            "tables": [{"name": "sites", "key": ["uid"]}, {"name": "visits", "key": ["uid"]}],
            "relations": [{"table": "visits", "column": "site_uid", "parent_table": "sites", "parent_column": "uid"}],
            "attachment_columns": [{"table": "sites", "column": "photo"}],
            "attachment_policy": "required", "job_name": "合成离线采集往返验收", "evidence_complete": True,
        },
    }


def mutate(source, sql, parameters=()):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "mutate.gpkg"
        path.write_bytes(base64.b64decode(source["data"]))
        db = sqlite3.connect(path)
        if parameters:
            db.execute(sql, parameters)
        else:
            db.executescript(sql)
        db.commit()
        db.close()
        return uploaded(source["name"], path.read_bytes())


def source_hashes(request):
    return {key: hashlib.sha256(base64.b64decode(request[key]["data"])).hexdigest()
            for key in ("baseline", "field", "target") if request.get(key)}


INTEGER_BOUNDARIES = (
    -(2 ** 63), -(2 ** 53 + 1), -(2 ** 53), -(2 ** 53 - 1),
    2 ** 53 - 1, 2 ** 53, 2 ** 53 + 1, 2 ** 63 - 1,
)


def integer_database(field=False):
    """独立合成64位证据，含无亲和性列以保留原始SQLite存储类型。"""
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "integer.sqlite"
        db = sqlite3.connect(path)
        db.executescript("""
            CREATE TABLE records(uid INTEGER PRIMARY KEY, metric INTEGER, note TEXT);
            CREATE TABLE composite(region TEXT, record_uid INTEGER, metric INTEGER,
                PRIMARY KEY(region, record_uid));
            CREATE TABLE typed(uid, metric, note TEXT);
            CREATE TABLE typed_links(uid TEXT PRIMARY KEY, parent_uid);
        """)
        for value in INTEGER_BOUNDARIES:
            db.execute("INSERT INTO records VALUES(?,?,?)", (value, value if field else 0, "现场" if field else "基线"))
            db.execute("INSERT INTO composite VALUES(?,?,?)", ("合成区", value, value if field else 0))
        large = 2 ** 53 + 1
        db.executemany("INSERT INTO typed VALUES(?,?,?)", [
            (large, str(large) if field else large, "整数键现场" if field else "整数键基线"),
            (str(large), large if field else str(large), "文本键现场" if field else "文本键基线"),
            (1, 1.0 if field else 1, "整数与实数"),
        ])
        db.executemany("INSERT INTO typed_links VALUES(?,?)", [("integer", large), ("text", str(large))])
        db.commit()
        db.close()
        return path.read_bytes()


def integer_payload():
    field = integer_database(field=True)
    return {
        "baseline": uploaded("64位出发基线.sqlite", integer_database()),
        "field": uploaded("64位现场返回.sqlite", field),
        "target": uploaded("64位导回目标.sqlite", field),
        "field_attachments": [], "target_attachments": [],
        "config": {
            "job_name": "合成64位整数验收",
            "tables": [{"name": "records", "key": ["uid"]},
                       {"name": "composite", "key": ["region", "record_uid"]},
                       {"name": "typed", "key": ["uid"]},
                       {"name": "typed_links", "key": ["uid"]}],
            "relations": [{"table": "composite", "column": "record_uid", "parent_table": "records", "parent_column": "uid"},
                          {"table": "typed_links", "column": "parent_uid", "parent_table": "typed", "parent_column": "uid"}],
            "attachment_columns": [], "attachment_policy": "required", "evidence_complete": True,
        },
    }


def integer_mismatch_payload():
    request = integer_payload()
    request["target"] = mutate(request["target"], "UPDATE records SET metric=? WHERE uid=?", (2 ** 53, 2 ** 53 + 1))
    request["target"] = mutate(request["target"], "UPDATE typed_links SET parent_uid=? WHERE uid='integer'", (-(2 ** 63),))
    return request


def integer_parent_payload():
    """仅按公开返修描述重建三库，未读取外部原始输入。"""
    request = integer_payload()
    with tempfile.TemporaryDirectory() as folder:
        for role, note in (("baseline", "old"), ("field", "new"), ("target", "wrong")):
            path = Path(folder) / (role + ".sqlite")
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE records(uid INTEGER PRIMARY KEY,note TEXT)")
            db.execute("INSERT INTO records VALUES(?,?)", (2 ** 53 + 1, note))
            db.commit()
            db.close()
            request[role] = uploaded(role + ".sqlite", path.read_bytes())
    request["config"]["tables"] = [{"name": "records", "key": ["uid"]}]
    request["config"]["relations"] = []
    request["config"]["job_name"] = "父返修描述独立重建"
    return request
