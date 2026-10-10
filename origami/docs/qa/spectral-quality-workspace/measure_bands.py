"""Independent NumPy FFT measurements of steady, unnormalized float-WAV renders."""
import csv, struct, sys
from pathlib import Path
import numpy as np
folder=Path(sys.argv[1]); rows=[]
for path in sorted(folder.glob('*.wav')):
 data=path.read_bytes();at=12;audio=None
 while at+8<=len(data):
  tag=data[at:at+4];size=struct.unpack_from('<I',data,at+4)[0]
  if tag==b'data':audio=np.frombuffer(data,dtype='<f4',count=size//4,offset=at+8).astype(float)
  at+=8+size+(size&1)
 if audio is None:raise ValueError(path)
 n=16384;window=np.hanning(n);freq=np.fft.rfftfreq(n,1/48000);powers=[]
 for start in range(0,len(audio)-n+1,n//2):
  spectrum=np.fft.rfft(audio[start:start+n]*window);power=2*np.abs(spectrum)**2/(n*np.sum(window**2));powers.append(power)
 power=np.mean(powers,axis=0);bands=[(20,200),(200,2000),(2000,5000),(5000,10000),(10000,24000)]
 row=[path.stem,float(np.max(np.abs(audio))),float(np.sqrt(np.mean(audio**2)))]
 row += [float(np.sum(power[(freq>=lo)&(freq<hi)])) for lo,hi in bands];rows.append(row)
if '--append' in sys.argv and (folder/'bands.csv').exists():
 existing={r[0]:r for r in list(csv.reader((folder/'bands.csv').open()))[1:]}
 for row in rows:existing[row[0]]=row
 rows=[existing[k] for k in sorted(existing)]
with (folder/'bands.csv').open('w') as f:
 writer=csv.writer(f,lineterminator='\n');writer.writerow(['render','peak','rms','20-200_power','200-2000_power','2000-5000_power','5000-10000_power','10000-24000_power']);writer.writerows(rows)
