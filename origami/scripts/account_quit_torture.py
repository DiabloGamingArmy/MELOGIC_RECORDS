#!/usr/bin/env python3
"""Normal JUCE quit probe, enabled only by ORIGAMI_ACCOUNT_QUIT_PROBE=ON.
Uses the probe build's isolated in-memory account; never opens the login Keychain.
"""
import argparse, json, os, pathlib, subprocess, time
p=argparse.ArgumentParser()
p.add_argument('binary',type=pathlib.Path)
p.add_argument('--cycles',type=int,default=50)
p.add_argument('--output',type=pathlib.Path,required=True)
a=p.parse_args()
marker=b'ORIGAMI_ACCOUNT_ISOLATED_QUIT_PROBE_V1'
if marker not in a.binary.read_bytes():
    raise SystemExit('Refusing launch: binary lacks the isolated account quit probe')
reports=pathlib.Path.home()/'Library/Logs/DiagnosticReports'
before=set(reports.glob('MCT Origami*.ips'))
rows=[]
for i in range(a.cycles):
    # Mix immediate quit and initialized/idle isolated account service.
    delay=[1,100,500,3000,5000][i%5]
    start=time.monotonic()
    r=subprocess.run([str(a.binary.resolve()),f'--account-quit-after-ms={delay}'],
        env={**os.environ,'MELOGIC_ACCOUNT_DIAGNOSTICS':'1'},capture_output=True,timeout=45)
    log=r.stderr.decode(errors='replace')
    row={'cycle':i+1,'quit_after_ms':delay,'exit':r.returncode,
         'seconds':round(time.monotonic()-start,3),
         'shutdown_completed':'stage=standalone outcome=shutdown_complete' in log,
         'isolated_account':marker.decode() in log,
         'authorized':'stage=authorization outcome=authorized' in log}
    rows.append(row)
    a.output.write_text(json.dumps({'cycles':rows,'new_crash_reports':len(set(reports.glob('MCT Origami*.ips'))-before)},indent=2)+'\n')
    print(json.dumps(row),flush=True)
    if r.returncode or not row['shutdown_completed'] or not row['isolated_account']:raise SystemExit('normal quit failed')
if set(reports.glob('MCT Origami*.ips'))-before:raise SystemExit('new crash report detected')
