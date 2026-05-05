#!/usr/bin/env node
/*
 * Geotab ignition probe — diagnoses why engine-watch is showing all
 * "Unavailable". Prints, for the database:
 *
 *   1. Diagnostic registry: every Diagnostic with "Ignition" in its name,
 *      so you see the actual id values (well-known string vs aXXXX GUID).
 *   2. StatusData sample by well-known string id ('DiagnosticIgnitionId') —
 *      what the app sends today. Record count, distinct device count,
 *      first/last timestamp, on/off counts.
 *   3. Same StatusData query but using the resolved id from section 1 —
 *      if section 2 is empty and section 3 has data, the well-known id
 *      isn't honored on this DB and we need to use the GUID.
 *
 * Usage:
 *   GEOTAB_DB=Bethrochel GEOTAB_USER=apiuser GEOTAB_PASS=xxx \
 *     node scripts/geotab-ignition-probe.js [hoursBack]
 *
 * Default hoursBack is 6.
 */

'use strict';

var https = require('https');

function httpsJson(host, path, body) {
    return new Promise(function (resolve, reject) {
        var data = Buffer.from(JSON.stringify(body));
        var req = https.request({
            method: 'POST', host: host, path: path, port: 443,
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'content-length': data.length,
                'accept': 'application/json'
            }
        }, function (res) {
            var chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () {
                var raw = Buffer.concat(chunks).toString('utf8');
                try {
                    var j = JSON.parse(raw);
                    if (j.error) return reject(new Error(j.error.message + ' (' + (j.error.errors && j.error.errors[0] && j.error.errors[0].name || '') + ')'));
                    resolve(j.result);
                } catch (e) { reject(new Error('Non-JSON response: ' + raw.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}
function rpc(host, method, params) { return httpsJson(host, '/apiv1', { method: method, params: params }); }

function summarizeStatusData(records) {
    if (!records || !records.length) return { count: 0 };
    var devices = {};
    var firstMs = Infinity, lastMs = -Infinity;
    var onCount = 0, offCount = 0;
    for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (!r) continue;
        if (r.device && r.device.id) devices[r.device.id] = true;
        var t = r.dateTime ? new Date(r.dateTime).getTime() : 0;
        if (t < firstMs) firstMs = t;
        if (t > lastMs) lastMs = t;
        if (typeof r.data === 'number') {
            if (r.data > 0) onCount++; else offCount++;
        }
    }
    return {
        count: records.length,
        deviceCount: Object.keys(devices).length,
        firstIso: isFinite(firstMs) ? new Date(firstMs).toISOString() : null,
        lastIso: isFinite(lastMs) ? new Date(lastMs).toISOString() : null,
        onCount: onCount,
        offCount: offCount,
        sample: records.slice(0, 3).map(function (r) {
            return {
                deviceId: r.device && r.device.id,
                dateTime: r.dateTime,
                data: r.data,
                diagnosticId: r.diagnostic && r.diagnostic.id
            };
        })
    };
}

async function main() {
    var db = process.env.GEOTAB_DB;
    var user = process.env.GEOTAB_USER;
    var pass = process.env.GEOTAB_PASS;
    if (!db || !user || !pass) {
        console.error('Missing env vars. Set GEOTAB_DB, GEOTAB_USER, GEOTAB_PASS.');
        process.exit(2);
    }
    var hoursBack = parseInt(process.argv[2], 10);
    if (!hoursBack || hoursBack <= 0) hoursBack = 6;

    var auth = await rpc('my.geotab.com', 'Authenticate', {
        database: db, userName: user, password: pass
    });
    var host = (auth.path && auth.path !== 'ThisServer') ? auth.path : 'my.geotab.com';
    var credentials = auth.credentials;
    console.log('## Authenticated');
    console.log('  database = ' + credentials.database);
    console.log('  user     = ' + credentials.userName);
    console.log('  server   = ' + host);

    // ---- 1. Diagnostic registry: anything with "ignition" in the name ----
    console.log('\n## 1. Diagnostic registry (search: name contains "Ignition")');
    var ignDiagsByName = await rpc(host, 'Get', {
        typeName: 'Diagnostic', search: { name: 'Ignition' }, credentials: credentials
    });
    function dumpDiag(d) {
        return '  - id=' + d.id + '\n    name="' + d.name + '"' +
            (d.diagnosticType ? ('\n    type=' + d.diagnosticType) : '') +
            (d.code != null ? ('\n    code=' + d.code) : '') +
            (d.source && d.source.id ? ('\n    sourceId=' + d.source.id) : '');
    }
    if (ignDiagsByName && ignDiagsByName.length) {
        ignDiagsByName.forEach(function (d) { console.log(dumpDiag(d)); });
    } else {
        console.log('  (no Diagnostic with name containing "Ignition")');
    }

    // Also try fetching by the well-known string id directly.
    console.log('\n## 1b. Diagnostic lookup by well-known string id');
    var wellKnown = 'DiagnosticIgnitionId';
    try {
        var hit = await rpc(host, 'Get', { typeName: 'Diagnostic', search: { id: wellKnown }, credentials: credentials });
        if (hit && hit.length) {
            console.log('  ' + wellKnown + ' resolves to:');
            console.log(dumpDiag(hit[0]));
        } else {
            console.log('  ' + wellKnown + ' returned 0 results');
        }
    } catch (e) {
        console.log('  ' + wellKnown + ' ERROR: ' + e.message);
    }

    // ---- 2. StatusData sample using the well-known string id (what the app does today) ----
    var nowMs = Date.now();
    var fromIso = new Date(nowMs - hoursBack * 60 * 60 * 1000).toISOString();
    var toIso = new Date(nowMs).toISOString();
    console.log('\n## 2. StatusData sample (last ' + hoursBack + 'h, query by well-known string id — what the app does)');
    console.log('  window = ' + fromIso + ' -> ' + toIso);
    try {
        var recs = await rpc(host, 'Get', {
            typeName: 'StatusData',
            search: { diagnosticSearch: { id: wellKnown }, fromDate: fromIso, toDate: toIso },
            resultsLimit: 50000,
            credentials: credentials
        });
        console.log('\n  ' + wellKnown + ':');
        console.log('    ' + JSON.stringify(summarizeStatusData(recs), null, 2).split('\n').join('\n    '));
    } catch (e) {
        console.log('\n  ' + wellKnown + ' ERROR: ' + e.message);
    }

    // ---- 3. Same query using the resolved id from the registry ----
    console.log('\n## 3. StatusData sample using resolved id from registry');
    var realIgn = (ignDiagsByName || []).find(function (d) { return /ignition/i.test(d.name) && !/aux|auxiliary/i.test(d.name); });
    if (!realIgn) {
        console.log('  No resolved id — skipping.');
    } else {
        try {
            var recs2 = await rpc(host, 'Get', {
                typeName: 'StatusData',
                search: { diagnosticSearch: { id: realIgn.id }, fromDate: fromIso, toDate: toIso },
                resultsLimit: 50000,
                credentials: credentials
            });
            console.log('\n  Ignition (resolved=' + realIgn.id + '):');
            console.log('    ' + JSON.stringify(summarizeStatusData(recs2), null, 2).split('\n').join('\n    '));
        } catch (e) {
            console.log('\n  Ignition (resolved) ERROR: ' + e.message);
        }
    }

    console.log('\n## Diagnosis hint:');
    console.log('  - If section 2 returns 0 records but section 3 returns records,');
    console.log('    the app is querying the wrong diagnostic id and we need to');
    console.log('    use the resolved GUID from section 1.');
    console.log('  - If both 2 and 3 return records, the app should be working;');
    console.log('    look at the freshness gate / engine zone polygon next.');
    console.log('  - If both return 0 records, devices may not be reporting');
    console.log('    ignition diagnostics on this database.');
}

main().catch(function (err) {
    console.error('ERROR: ' + (err && err.message ? err.message : err));
    process.exit(1);
});
