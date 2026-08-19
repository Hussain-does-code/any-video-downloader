const fs = require('fs');
const path = require('path');

async function testDownloadRelay() {
  const targetVideo = 'https://www.freepornvideos.xxx/get_file/8512/2bf1c4305b9521fe76ed9a16471c5ce19683ae7c57/93767000/93767538/93767538_2160m.mp4/';
  const outputPath = path.join(__dirname, 'test_sample.mp4');

  console.log('Testing video stream download through cloud relays...');

  const relays = [
    // Relay 1: corsproxy.org with custom headers
    async (url) => {
      return fetch(`https://corsproxy.org/?${encodeURIComponent(url)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.freepornvideos.xxx/'
        }
      });
    },
    // Relay 2: proxy.cors.sh
    async (url) => {
      return fetch(`https://proxy.cors.sh/${url}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.freepornvideos.xxx/'
        }
      });
    }
  ];

  for (let i = 0; i < relays.length; i++) {
    try {
      console.log(`Trying relay #${i + 1}...`);
      const res = await relays[i](targetVideo);
      console.log(`Relay #${i + 1} Status:`, res.status, 'Content-Type:', res.headers.get('content-type'), 'Length:', res.headers.get('content-length'));
      
      if (res.ok && res.body) {
        const fileStream = fs.createWriteStream(outputPath);
        const reader = res.body.getReader();
        let bytesDownloaded = 0;
        
        while (bytesDownloaded < 500000) { // Download first 500KB to verify
          const { done, value } = await reader.read();
          if (done) break;
          fileStream.write(Buffer.from(value));
          bytesDownloaded += value.length;
        }
        fileStream.close();
        console.log(`🎉 SUCCESS! Downloaded ${bytesDownloaded} bytes via Relay #${i + 1}`);
        
        const stat = fs.statSync(outputPath);
        console.log('Saved file size:', stat.size);
        try { fs.unlinkSync(outputPath); } catch (e) {}
        return true;
      }
    } catch (err) {
      console.log(`Relay #${i + 1} failed:`, err.message);
    }
  }
  return false;
}

testDownloadRelay().then(ok => console.log('Relay test result:', ok));
