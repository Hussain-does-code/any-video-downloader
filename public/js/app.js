// Apex Video Downloader — Glass Ribbons & Intelligent Flow Engine Frontend Logic
// Robust, high-speed, and production-tested.

document.addEventListener('DOMContentLoaded', () => {
  // ─── DOM References ───
  const videoUrlInput          = document.getElementById('videoUrlInput');
  const pasteBtn               = document.getElementById('pasteBtn');
  const clearBtn               = document.getElementById('clearBtn');
  const fetchBtn               = document.getElementById('fetchBtn');
  const btnText                = fetchBtn ? fetchBtn.querySelector('.btn-text') : null;
  const btnSpinner             = fetchBtn ? fetchBtn.querySelector('.btn-spinner') : null;

  const errorBanner            = document.getElementById('errorBanner');
  const errorTitle             = document.getElementById('errorTitle');
  const errorMessage           = document.getElementById('errorMessage');
  const closeErrorBtn          = document.getElementById('closeErrorBtn');

  const resultSection          = document.getElementById('resultSection');
  const videoThumb             = document.getElementById('videoThumb');
  const videoDuration          = document.getElementById('videoDuration');
  const siteBadge              = document.getElementById('siteBadge');
  const siteName               = document.getElementById('siteName');
  const videoTitle             = document.getElementById('videoTitle');
  const videoUploader          = document.getElementById('videoUploader');
  const videoViews             = document.getElementById('videoViews');
  const viewsContainer         = document.getElementById('viewsContainer');
  const maxQualityBadge        = document.getElementById('maxQualityBadge');

  const toggleSegmentBtns      = document.querySelectorAll('.toggle-segment-btn');
  const tabPanes               = document.querySelectorAll('.tab-pane');
  const videoFormatsGrid       = document.getElementById('videoFormatsGrid');
  const audioFormatsGrid       = document.getElementById('audioFormatsGrid');

  const activeDownloadsSection = document.getElementById('activeDownloadsSection');
  const activeDownloadsList    = document.getElementById('activeDownloadsList');

  const openFolderBtn          = document.getElementById('openFolderBtn');
  const toggleHistoryBtn       = document.getElementById('toggleHistoryBtn');
  const historyCount           = document.getElementById('historyCount');
  const historyDrawer          = document.getElementById('historyDrawer');
  const drawerOverlay          = document.getElementById('drawerOverlay');
  const closeHistoryBtn        = document.getElementById('closeHistoryBtn');
  const openFolderDrawerBtn    = document.getElementById('openFolderDrawerBtn');
  const historyList            = document.getElementById('historyList');

  const cancelConfirmModal     = document.getElementById('cancelConfirmModal');
  const cancelConfirmText      = document.getElementById('cancelConfirmText');
  const cancelConfirmNoBtn     = document.getElementById('cancelConfirmNoBtn');
  const cancelConfirmYesBtn    = document.getElementById('cancelConfirmYesBtn');
  let pendingCancelDownloadId  = null;

  const toastContainer         = document.getElementById('toastContainer');

  // State Management
  let currentVideoData = null;
  const activeEventSources = new Map();

  // ─── Toast Notifications ───
  function showToast(message, type = 'info', icon = 'fa-circle-info') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ─── Error Banner Handlers ───
  function showError(title, msg) {
    if (!errorBanner) return;
    if (errorTitle) errorTitle.textContent = title;
    if (errorMessage) errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
    if (resultSection) resultSection.classList.add('hidden');
  }

  function hideError() {
    if (errorBanner) errorBanner.classList.add('hidden');
  }

  if (closeErrorBtn) {
    closeErrorBtn.addEventListener('click', hideError);
  }

  // ─── Input Listeners ───
  if (videoUrlInput) {
    videoUrlInput.addEventListener('input', () => {
      if (clearBtn) {
        clearBtn.classList.toggle('hidden', videoUrlInput.value.trim().length === 0);
      }
    });

    videoUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') analyzeVideo();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (videoUrlInput) {
        videoUrlInput.value = '';
        clearBtn.classList.add('hidden');
        videoUrlInput.focus();
      }
    });
  }

  // ─── Clipboard Paste ───
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().startsWith('http')) {
          if (videoUrlInput) {
            videoUrlInput.value = text.trim();
            if (clearBtn) clearBtn.classList.remove('hidden');
            showToast('Stream link pasted!', 'success', 'fa-check');
            analyzeVideo();
          }
        } else {
          showToast('Please copy a valid video URL first.', 'info', 'fa-copy');
        }
      } catch (err) {
        if (videoUrlInput) videoUrlInput.focus();
        showToast('Press Ctrl+V to paste your video link.', 'info', 'fa-keyboard');
      }
    });
  }

  // Global Ctrl+V Shortcut
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (document.activeElement !== videoUrlInput) {
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.trim().startsWith('http') && videoUrlInput) {
            videoUrlInput.value = text.trim();
            if (clearBtn) clearBtn.classList.remove('hidden');
            showToast('Stream link pasted!', 'success', 'fa-check');
            videoUrlInput.focus();
            analyzeVideo();
          }
        } catch (err) {}
      }
    }
  });

  if (fetchBtn) {
    fetchBtn.addEventListener('click', analyzeVideo);
  }

  // ─── Segmented Format Toggle ───
  toggleSegmentBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleSegmentBtns.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });

  // ─── Analyze Video Function ───
  async function analyzeVideo() {
    if (!videoUrlInput) return;
    let url = videoUrlInput.value.trim();

    if (!url) {
      showError('No Link Entered', 'Please paste a valid video URL from any supported network.');
      videoUrlInput.focus();
      return;
    }

    // Auto-fix protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.startsWith('//')) {
        url = 'https:' + url;
      } else if (url.includes('.') && !url.startsWith('?')) {
        url = 'https://' + url;
      }
    }

    if (url.startsWith('?') || !url.startsWith('http')) {
      showError('Incomplete URL', 'Please paste the full video URL including domain name.');
      videoUrlInput.focus();
      return;
    }

    videoUrlInput.value = url;
    hideError();
    setLoading(true);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to analyze video stream.');
      }

      currentVideoData = json.data;
      renderVideoResult(json.data);
      showToast('Video stream analysis complete!', 'success', 'fa-circle-check');
    } catch (err) {
      showError('Extraction Failed', err.message || 'Could not fetch video stream metadata.');
    } finally {
      setLoading(false);
    }
  }

  function setLoading(isLoading) {
    if (!fetchBtn) return;
    fetchBtn.disabled = isLoading;
    if (btnText) btnText.classList.toggle('hidden', isLoading);
    if (btnSpinner) btnSpinner.classList.toggle('hidden', !isLoading);
  }

  // ─── Render Video Result ───
  function renderVideoResult(data) {
    if (!resultSection) return;

    if (videoTitle) videoTitle.textContent = data.title || 'Untitled Video';
    if (videoThumb) {
      const thumbUrl = data.thumbnail || '';
      if (thumbUrl.startsWith('http') && !thumbUrl.includes('/api/proxy-image')) {
        videoThumb.src = `/api/proxy-image?url=${encodeURIComponent(thumbUrl)}`;
      } else {
        videoThumb.src = thumbUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="%23141b2d"/><text x="50%" y="50%" fill="%23818cf8" font-size="22" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">▶ Video Stream</text></svg>';
      }
      videoThumb.onerror = () => {
        videoThumb.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="%23141b2d"/><text x="50%" y="50%" fill="%23818cf8" font-size="22" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">▶ Video Stream</text></svg>';
      };
    }
    if (videoDuration) videoDuration.textContent = data.durationFormatted || '00:00';
    if (videoUploader) videoUploader.textContent = data.uploader || 'Channel';
    if (siteName) siteName.textContent = data.site || 'Web';

    if (viewsContainer && videoViews) {
      if (data.viewCount) {
        videoViews.textContent = `${data.viewCount} views`;
        viewsContainer.classList.remove('hidden');
      } else {
        viewsContainer.classList.add('hidden');
      }
    }

    // Quality Badge
    if (maxQualityBadge) {
      const has8K = (data.videoFormats || []).some((f) => f.height >= 4320 || f.badge === '8K');
      const has4K = (data.videoFormats || []).some((f) => f.height >= 2160 || f.badge === '4K');
      const has2K = (data.videoFormats || []).some((f) => f.height >= 1440 || f.badge === '2K');

      if (has8K) {
        maxQualityBadge.innerHTML = `<i class="fa-solid fa-crown"></i><span>8K Ultra HD</span>`;
      } else if (has4K) {
        maxQualityBadge.innerHTML = `<i class="fa-solid fa-crown"></i><span>4K Ultra HD</span>`;
      } else if (has2K) {
        maxQualityBadge.innerHTML = `<i class="fa-solid fa-star"></i><span>2K Quad HD</span>`;
      } else {
        maxQualityBadge.innerHTML = `<i class="fa-solid fa-sparkles"></i><span>1080p Full HD</span>`;
      }
      maxQualityBadge.classList.remove('hidden');
    }

    // Render Video Format Rows
    if (videoFormatsGrid) {
      videoFormatsGrid.innerHTML = '';
      if (!data.videoFormats || data.videoFormats.length === 0) {
        videoFormatsGrid.innerHTML = `<div class="empty-state-card"><p>No standard video formats detected.</p></div>`;
      } else {
        data.videoFormats.forEach((f) => {
          const is8k = f.height >= 4320 || f.badge === '8K';
          const is4k = f.height >= 2160 || f.badge === '4K';
          const row = document.createElement('div');
          row.className = `stream-format-row ${is8k ? 'is-8k' : is4k ? 'is-4k' : ''}`;

          let fpsLabel = f.fps && f.fps >= 50 ? `${f.fps}fps • ` : '';

            const safeTitle = (data.title || 'video').replace(/[/\\?%*:|"<>]/g, '_');
            row.innerHTML = `
            <div class="row-left-details">
              <div class="res-tag-badge">${f.badge}</div>
              <div class="format-text-meta">
                <h4>${f.label}</h4>
                <p>${fpsLabel}MP4 Video Stream • High Quality</p>
              </div>
            </div>
            <div class="row-right-actions">
              <span class="file-size-indicator">${f.sizeFormatted || 'Original Quality'}</span>
              ${f.directUrl ? `
                <button class="copy-direct-btn" data-url="${f.directUrl}" title="Copy Direct Stream Link">
                  <i class="fa-solid fa-link"></i>
                  <span>Copy</span>
                </button>
              ` : ''}
              <button class="download-stream-btn" data-type="video" data-id="${f.formatId}" data-height="${f.height}" data-direct-url="${f.directUrl || ''}">
                <i class="fa-solid fa-arrow-down"></i>
                <span>Download</span>
              </button>
            </div>
          `;
          videoFormatsGrid.appendChild(row);
        });
      }
    }

    // Render Audio Format Rows
    if (audioFormatsGrid) {
      audioFormatsGrid.innerHTML = '';
      if (!data.audioFormats || data.audioFormats.length === 0) {
        const row = document.createElement('div');
        row.className = 'stream-format-row';
        row.innerHTML = `
          <div class="row-left-details">
            <div class="res-tag-badge">MP3</div>
            <div class="format-text-meta">
              <h4>Audio Stream (Best Fidelity)</h4>
              <p>MP3 Audio • Studio Quality</p>
            </div>
          </div>
          <div class="row-right-actions">
            <span class="file-size-indicator">Best Quality</span>
            <button class="download-stream-btn" data-type="audio" data-id="bestaudio">
              <i class="fa-solid fa-music"></i>
              <span>Download MP3</span>
            </button>
          </div>
        `;
        audioFormatsGrid.appendChild(row);
      } else {
        data.audioFormats.slice(0, 4).forEach((a) => {
          const row = document.createElement('div');
          row.className = 'stream-format-row';
          row.innerHTML = `
            <div class="row-left-details">
              <div class="res-tag-badge">MP3</div>
              <div class="format-text-meta">
                <h4>MP3 Audio (${a.quality})</h4>
                <p>${a.codec || 'Audio Stream'} • High Fidelity</p>
              </div>
            </div>
            <div class="row-right-actions">
              <span class="file-size-indicator">${a.sizeFormatted || 'Best Quality'}</span>
              ${a.directUrl ? `
                <button class="copy-direct-btn" data-url="${a.directUrl}" title="Copy Direct Audio Link">
                  <i class="fa-solid fa-link"></i>
                  <span>Copy</span>
                </button>
              ` : ''}
              <button class="download-stream-btn" data-type="audio" data-id="${a.formatId}" data-direct-url="${a.directUrl || ''}">
                <i class="fa-solid fa-music"></i>
                <span>Download MP3</span>
              </button>
            </div>
          `;
          audioFormatsGrid.appendChild(row);
        });
      }
    }

    // Attach Copy Direct Link Event Listeners
    document.querySelectorAll('.copy-direct-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        if (url) {
          try {
            await navigator.clipboard.writeText(url);
            showToast('Direct stream link copied to clipboard!', 'success', 'fa-copy');
          } catch (err) {
            showToast('Could not copy link.', 'error', 'fa-triangle-exclamation');
          }
        }
      });
    });

    // Attach Download Event Listeners (Starts 16-parallel socket high-speed engine)
    document.querySelectorAll('.download-stream-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const isAudio = btn.dataset.type === 'audio';
        const formatId = btn.dataset.id;
        const height = btn.dataset.height;
        const directUrl = btn.dataset.directUrl;
        startDownload({ isAudio, formatId, height, directUrl });
      });
    });

    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── Direct Browser Downloader (Bypasses ISP DPI) ───
  function triggerBrowserDownload(directUrl, filename, badge) {
    showToast(`Downloading ${badge ? badge + ' ' : ''}video via browser...`, 'success', 'fa-cloud-arrow-down');

    const downloadId = 'browser_' + Math.random().toString(36).substring(2, 9);
    if (activeDownloadsSection) activeDownloadsSection.classList.remove('hidden');
    if (activeDownloadsList) {
      const card = document.createElement('div');
      card.className = 'pipeline-download-card';
      card.id = `download-${downloadId}`;
      card.innerHTML = `
        <div class="pipeline-header">
          <div class="pipeline-title">
            <i class="fa-solid fa-film"></i>
            <span>${filename.replace(/\.(mp4|mp3)$/i, '')}</span>
          </div>
          <div class="pipeline-actions-right">
            <span class="status-pill completed">Downloading</span>
          </div>
        </div>
        <div class="progress-flow-wrap">
          <div class="progress-flow-track">
            <div class="progress-flow-fill" style="width: 100%; background: linear-gradient(90deg, #059669, #10B981);"></div>
          </div>
          <div class="progress-flow-meta">
            <span>Direct stream downloading via your browser's download manager</span>
            <span>Check browser downloads</span>
          </div>
        </div>
        <div class="completed-action-row" style="margin-top: 12px; display: flex; gap: 10px;">
          <a href="${directUrl}" target="_blank" rel="noopener noreferrer" class="save-file-cta" style="background: #0F172A;">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
            <span>Open Stream</span>
          </a>
          <button class="save-file-cta copy-direct-btn" data-url="${directUrl}" style="background: #2563EB;">
            <i class="fa-solid fa-copy"></i>
            <span>Copy Stream URL</span>
          </button>
        </div>
      `;
      activeDownloadsList.prepend(card);
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const newCopyBtn = card.querySelector('.copy-direct-btn');
      if (newCopyBtn) {
        newCopyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(directUrl);
            showToast('Stream URL copied to clipboard!', 'success', 'fa-copy');
          } catch (e) {}
        });
      }
    }

    const a = document.createElement('a');
    a.href = directUrl;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  }

  // ─── Start Download Pipeline ───
  async function startDownload({ isAudio, formatId, height, directUrl }) {
    if (!currentVideoData) return;

    showToast('Initializing high-speed stream pipeline...', 'info', 'fa-bolt');
    if (activeDownloadsSection) activeDownloadsSection.classList.remove('hidden');

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentVideoData.webpageUrl,
          title: currentVideoData.title,
          formatId: formatId,
          height: height,
          isAudio: isAudio,
          directUrl: directUrl || null,
          ext: isAudio ? 'mp3' : 'mp4'
        })
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Could not start download pipeline.');
      }

      createActiveDownloadCard(json.downloadId, currentVideoData.title, isAudio);
      subscribeToProgress(json.downloadId);
      loadHistory();
    } catch (err) {
      showToast(err.message || 'Stream download failed to initialize.', 'error', 'fa-triangle-exclamation');
    }
  }

  // ─── Create Active Download Card ───
  function createActiveDownloadCard(downloadId, title, isAudio) {
    if (!activeDownloadsList) return;

    const card = document.createElement('div');
    card.className = 'pipeline-download-card';
    card.id = `download-${downloadId}`;
    card.innerHTML = `
      <div class="pipeline-header">
        <div class="pipeline-title">
          <i class="fa-solid ${isAudio ? 'fa-music' : 'fa-film'}"></i>
          <span>${title}</span>
        </div>
        <div class="pipeline-actions-right">
          <span class="status-pill" id="status-badge-${downloadId}">Starting</span>
          <button class="cancel-stream-btn" id="cancel-btn-${downloadId}" title="Stop download">
            <i class="fa-solid fa-xmark"></i>
            <span>Cancel</span>
          </button>
        </div>
      </div>
      
      <div class="progress-flow-wrap">
        <div class="progress-flow-track">
          <div class="progress-flow-fill" id="progress-bar-${downloadId}" style="width: 0%;"></div>
        </div>
        <div class="progress-flow-meta">
          <span id="progress-text-${downloadId}">0% • Initializing pipeline...</span>
          <span id="speed-text-${downloadId}">-- MB/s • ETA: --</span>
        </div>
      </div>

      <div class="completed-action-row hidden" id="actions-${downloadId}">
        <a href="/api/file/${downloadId}" class="save-file-cta" download>
          <i class="fa-solid fa-cloud-arrow-down"></i>
          <span>Save to Device</span>
        </a>
      </div>
    `;

    // Cancel Button Click
    const cancelBtn = card.querySelector(`#cancel-btn-${downloadId}`);
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        pendingCancelDownloadId = downloadId;
        if (cancelConfirmText) cancelConfirmText.textContent = `Are you sure you want to cancel the download for "${title}"?`;
        if (cancelConfirmModal) cancelConfirmModal.classList.remove('hidden');
      });
    }

    activeDownloadsList.prepend(card);
    if (activeDownloadsSection) activeDownloadsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ─── Cancel Confirmation Handlers ───
  if (cancelConfirmNoBtn) {
    cancelConfirmNoBtn.addEventListener('click', () => {
      if (cancelConfirmModal) cancelConfirmModal.classList.add('hidden');
      pendingCancelDownloadId = null;
    });
  }

  if (cancelConfirmModal) {
    cancelConfirmModal.addEventListener('click', (e) => {
      if (e.target === cancelConfirmModal) {
        cancelConfirmModal.classList.add('hidden');
        pendingCancelDownloadId = null;
      }
    });
  }

  if (cancelConfirmYesBtn) {
    cancelConfirmYesBtn.addEventListener('click', async () => {
      if (!pendingCancelDownloadId) return;
      const id = pendingCancelDownloadId;
      if (cancelConfirmModal) cancelConfirmModal.classList.add('hidden');
      pendingCancelDownloadId = null;

      showToast('Stopping stream download...', 'info', 'fa-ban');

      try {
        await fetch(`/api/download/cancel/${id}`, { method: 'POST' });

        const badge = document.getElementById(`status-badge-${id}`);
        const bar = document.getElementById(`progress-bar-${id}`);
        const progressText = document.getElementById(`progress-text-${id}`);
        const speedText = document.getElementById(`speed-text-${id}`);
        const cancelBtn = document.getElementById(`cancel-btn-${id}`);

        if (badge) {
          badge.textContent = 'Cancelled';
          badge.className = 'status-pill cancelled';
        }
        if (bar) {
          bar.style.width = '100%';
          bar.className = 'progress-flow-fill cancelled';
        }
        if (progressText) progressText.textContent = 'Download stopped by user';
        if (speedText) speedText.textContent = 'Cancelled';
        if (cancelBtn) cancelBtn.classList.add('hidden');

        const es = activeEventSources.get(id);
        if (es) {
          es.close();
          activeEventSources.delete(id);
        }

        showToast('Stream download cancelled.', 'info', 'fa-circle-check');
      } catch (err) {
        showToast('Could not cancel download.', 'error', 'fa-triangle-exclamation');
      }
    });
  }

  // ─── SSE Real-Time Progress Stream ───
  function subscribeToProgress(downloadId) {
    const eventSource = new EventSource(`/api/progress/${downloadId}`);
    activeEventSources.set(downloadId, eventSource);

    const badge = document.getElementById(`status-badge-${downloadId}`);
    const bar = document.getElementById(`progress-bar-${downloadId}`);
    const progressText = document.getElementById(`progress-text-${downloadId}`);
    const speedText = document.getElementById(`speed-text-${downloadId}`);
    const actions = document.getElementById(`actions-${downloadId}`);
    const cancelBtn = document.getElementById(`cancel-btn-${downloadId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const percent = Math.min(100, Math.max(0, data.percent || 0));

        if (bar && data.status !== 'cancelled') bar.style.width = `${percent}%`;

        if (data.status === 'downloading') {
          if (badge) {
            badge.textContent = 'Downloading';
            badge.className = 'status-pill';
          }
          if (progressText) progressText.textContent = `${percent.toFixed(1)}% of ${data.totalSize || '--'}`;
          if (speedText) speedText.textContent = `${data.speed || '--'} • ETA: ${data.eta || '--'}`;
        } else if (data.status === 'merging') {
          if (badge) {
            badge.textContent = 'Merging Streams';
            badge.className = 'status-pill merging';
          }
          if (bar) bar.classList.add('merging');
          if (progressText) progressText.textContent = 'Merging video & audio streams with FFmpeg...';
          if (speedText) speedText.textContent = 'Processing Pipeline';
        } else if (data.status === 'completed') {
          if (badge) {
            badge.textContent = 'Completed';
            badge.className = 'status-pill completed';
          }
          if (bar) {
            bar.style.width = '100%';
            bar.classList.remove('merging');
          }
          if (progressText) progressText.textContent = '100% • Stream Download Finished!';
          if (speedText) speedText.textContent = 'Saved to Downloads Directory';
          if (actions) actions.classList.remove('hidden');
          if (cancelBtn) cancelBtn.classList.add('hidden');

          showToast('Stream download complete! File ready.', 'success', 'fa-circle-check');
          eventSource.close();
          activeEventSources.delete(downloadId);
          loadHistory();

          // Auto-download trigger
          const autoLink = document.createElement('a');
          autoLink.href = `/api/file/${downloadId}`;
          autoLink.download = data.outputFile || 'video.mp4';
          document.body.appendChild(autoLink);
          autoLink.click();
          autoLink.remove();
        } else if (data.status === 'cancelled') {
          if (badge) {
            badge.textContent = 'Cancelled';
            badge.className = 'status-pill cancelled';
          }
          if (bar) {
            bar.style.width = '100%';
            bar.className = 'progress-flow-fill cancelled';
          }
          if (progressText) progressText.textContent = 'Download cancelled';
          if (speedText) speedText.textContent = 'Stopped';
          if (cancelBtn) cancelBtn.classList.add('hidden');
          eventSource.close();
          activeEventSources.delete(downloadId);
        } else if (data.status === 'error') {
          if (badge) {
            badge.textContent = 'Blocked by ISP';
            badge.style.background = '#FEF2F2';
            badge.style.color = '#DC2626';
          }
          if (cancelBtn) cancelBtn.classList.add('hidden');
          if (progressText) progressText.textContent = data.error || 'Server connection blocked by ISP firewall.';
          if (speedText) speedText.textContent = 'Use Direct Download below';
          
          if (actions && currentVideoData?.videoFormats?.[0]?.directUrl) {
            const streamUrl = currentVideoData.videoFormats[0].directUrl;
            const safeTitle = (currentVideoData.title || 'video').replace(/[/\\?%*:|"<>]/g, '_');
            actions.innerHTML = `
              <a href="${streamUrl}" download="${safeTitle}.mp4" target="_blank" rel="noopener noreferrer" class="save-file-cta" style="background: #2563EB;">
                <i class="fa-solid fa-cloud-arrow-down"></i>
                <span>Download Directly in Browser</span>
              </a>
              <a href="${streamUrl}" target="_blank" rel="noopener noreferrer" class="save-file-cta" style="background: #0F172A;">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                <span>Open Stream (VLC / Browser)</span>
              </a>
            `;
            actions.classList.remove('hidden');

            // Automatically open direct download link
            const a = document.createElement('a');
            a.href = streamUrl;
            a.download = `${safeTitle}.mp4`;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            a.remove();
          }

          eventSource.close();
          activeEventSources.delete(downloadId);
        }
      } catch (e) {
        console.error('SSE Progress Parsing Error:', e);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      activeEventSources.delete(downloadId);
    };
  }

  // ─── Download History ───
  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      const json = await res.json();
      if (json.ok && json.history) {
        if (historyCount) historyCount.textContent = json.history.length;
        renderHistoryList(json.history);
      }
    } catch (e) {}
  }

  function renderHistoryList(items) {
    if (!historyList) return;
    historyList.innerHTML = '';
    if (items.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state-card">
          <i class="fa-solid fa-cloud-arrow-down"></i>
          <p>No downloads recorded yet. Paste a link above to start!</p>
        </div>
      `;
      return;
    }

    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-entry-card';
      const isAudio = item.filename.endsWith('.mp3');
      el.innerHTML = `
        <div class="entry-text-info">
          <h5><i class="fa-solid ${isAudio ? 'fa-music' : 'fa-film'}"></i> ${item.cleanName}</h5>
          <p>${item.sizeFormatted} • ${new Date(item.createdAt).toLocaleTimeString()}</p>
        </div>
        <a href="${item.downloadUrl}" class="entry-save-btn" download>
          <i class="fa-solid fa-download"></i>
          <span>Save</span>
        </a>
      `;
      historyList.appendChild(el);
    });
  }

  // ─── History Drawer Slide-Over ───
  function openHistoryDrawer() {
    loadHistory();
    if (historyDrawer) {
      historyDrawer.classList.remove('hidden');
      historyDrawer.classList.remove('drawer-closing');
    }
  }

  function closeHistoryDrawer() {
    if (historyDrawer) {
      historyDrawer.classList.add('drawer-closing');
      setTimeout(() => {
        historyDrawer.classList.add('hidden');
        historyDrawer.classList.remove('drawer-closing');
      }, 260);
    }
  }

  if (toggleHistoryBtn) toggleHistoryBtn.addEventListener('click', openHistoryDrawer);
  if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeHistoryDrawer);

  // ─── Open Folder Handlers ───
  async function openDownloadsFolder() {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isLocal) {
      showToast('Your video downloads are saved directly into your device\'s browser downloads folder.', 'info', 'fa-folder-open');
      return;
    }
    try {
      const res = await fetch('/api/open-folder', { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        showToast('Opened downloads folder in file manager!', 'success', 'fa-folder-open');
      }
    } catch (e) {
      showToast('Could not open storage folder automatically.', 'error', 'fa-triangle-exclamation');
    }
  }

  if (openFolderBtn) openFolderBtn.addEventListener('click', openDownloadsFolder);
  if (openFolderDrawerBtn) openFolderDrawerBtn.addEventListener('click', openDownloadsFolder);

  // Initial History Load
  loadHistory();
});
