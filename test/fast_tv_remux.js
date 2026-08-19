const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ffmpeg = require('ffmpeg-static') || 'bin/ffmpeg.exe';
const downloads = fs.readdirSync('downloads');
const file = downloads.find(f => f.endsWith('.mp4') && !f.includes('TV'));

const inputPath = path.join(__dirname, '../downloads', file);
const outputPath = path.join(__dirname, '../downloads', 'Kylie_Quinn_Android_TV_FastStart.mp4');

console.log('Remuxing with FastStart & Universal MP42 tags:');
console.log('Input:', inputPath);
console.log('Output:', outputPath);

const args = [
  '-i', inputPath,
  '-c', 'copy',
  '-movflags', '+faststart',
  '-brand', 'mp42',
  '-y',
  outputPath
];

const startTime = Date.now();
const proc = spawn(ffmpeg, args);

proc.stderr.on('data', d => {});
proc.on('close', (code) => {
  console.log(`Remux finished in ${(Date.now() - startTime) / 1000}s with code: ${code}`);
  if (code === 0 && fs.existsSync(outputPath)) {
    console.log('🎉 FastStart Android TV file ready! Size:', fs.statSync(outputPath).size, 'bytes');
  }
});
