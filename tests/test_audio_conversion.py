"""Host FFmpeg regression with synthetic 5.1 AC-3/E-AC-3.
Not an Android native-library or user-movie test. Requires imageio-ffmpeg.
"""
import subprocess, tempfile, pathlib, math, array
import imageio_ffmpeg
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
def run(args):
    return subprocess.run([ffmpeg,'-hide_banner','-loglevel','error',*args],check=True,capture_output=True)
with tempfile.TemporaryDirectory() as temp:
    d=pathlib.Path(temp); source=d/'synthetic.mkv'
    run(['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=65',
         '-filter_complex','[0:a]pan=5.1|c0=c0|c1=c0|c2=c0|c3=0*c0|c4=c0|c5=c0,asplit=2[a][b]',
         '-map','[a]','-map','[b]','-c:a:0','ac3','-c:a:1','eac3',str(source)])
    for track,codec in [(0,'AC-3'),(1,'E-AC-3')]:
        for start,expected in [(0,60),(60,5)]:
            dest=d/f'{track}-{start}.m4a'
            run(['-nostdin','-y','-threads','2','-ss',str(start),'-i',str(source),'-t','60',
                 '-map',f'0:a:{track}','-vn','-sn','-dn','-af','asetpts=PTS-STARTPTS',
                 '-c:a','aac','-ac','2','-ar','48000','-b:a','160k','-threads','2','-movflags','+faststart',str(dest)])
            pcm=run(['-i',str(dest),'-f','s16le','-acodec','pcm_s16le','-']).stdout
            samples=array.array('h'); samples.frombytes(pcm)
            duration=len(samples)/2/48000
            rms=math.sqrt(sum(v*v for v in samples)/len(samples))
            assert abs(duration-expected)<0.15,(duration,expected)
            assert rms>10, 'Silent output'
            assert dest.stat().st_size<4*1024*1024
            print(f'PASS host {codec} 5.1 -> AAC stereo: start={start}, duration={duration:.2f}s, non-silent RMS={rms:.1f}')
