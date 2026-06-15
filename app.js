/**
 * GolTV Sports - Live Streaming Application
 * Core JavaScript Logic (Berbahasa Indonesia)
 * Versi Flat Stream (Satu stream = satu kartu, duplikat dinomori) dengan Kategori & Negara Filter, serta Resolusi Badges.
 */

// URL Endpoint API dari iptv-org
const STREAMS_API_URL = "https://iptv-org.github.io/api/streams.json";
const CHANNELS_API_URL = "https://iptv-org.github.io/api/channels.json";
const COUNTRIES_API_URL = "https://iptv-org.github.io/api/countries.json";

// Inisialisasi State Aplikasi
let allChannels = [];       // Menyimpan seluruh data saluran yang telah dimuat (flat list)
let filteredChannels = [];  // Menyimpan data saluran setelah filter pencarian/kategori/negara
let activeChannel = null;   // Saluran yang sedang aktif diputar
let hlsInstance = null;     // Instansi Hls.js untuk pemutaran stream m3u8
let favoriteChannelIds = new Set(JSON.parse(localStorage.getItem("tv_favorites") || "[]")); // Daftar ID saluran favorit


// Konfigurasi Pagination (Halaman)
let currentPage = 1;
const pageSize = 30;        // Tampilkan 30 saluran per halaman agar performa cepat
let totalPages = 1;

// Referensi Elemen DOM Utama
const videoElement = document.getElementById("video");
const videoWrapper = document.getElementById("video-wrapper");
const videoLoadingOverlay = document.getElementById("video-loading-overlay");
const videoErrorOverlay = document.getElementById("video-error-overlay");
const btnRetry = document.getElementById("btn-retry");
const btnRefreshApi = document.getElementById("btn-refresh-api");

const searchInput = document.getElementById("search-input");
const channelCounter = document.getElementById("channel-counter");
const sidebarLoader = document.getElementById("sidebar-loader");
const sidebarError = document.getElementById("sidebar-error");
const channelsListContainer = document.getElementById("channels-list");

// Referensi Elemen Kategori, Negara, dan Pagination
const categoryFilter = document.getElementById("category-filter");
const countryFilter = document.getElementById("country-filter");
const channelListScroller = document.getElementById("channel-list-scroller");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const pageIndicator = document.getElementById("page-indicator");
const sidebarSubBadge = document.getElementById("sidebar-sub-badge");

// Informasi Saluran Aktif (Metadata)
const currentChannelName = document.getElementById("current-channel-name");
const currentChannelCountry = document.getElementById("current-channel-country");
const currentChannelCategory = document.getElementById("current-channel-category");
const currentLogoContainer = document.getElementById("current-logo-container");

// Referensi Elemen Navigasi Video Overlay
const videoNavPrev = document.getElementById("video-nav-prev");
const videoNavNext = document.getElementById("video-nav-next");
const videoAspectBtn = document.getElementById("video-aspect-btn");
const videoToast = document.getElementById("video-toast");

// Konfigurasi Aspek Rasio Video
const aspectRatios = ["contain", "fill", "cover"];
const aspectRatioLabels = ["Fit (Asli)", "Stretch (Penuh)", "Zoom (Potong)"];
let currentAspectIdx = 0;


/**
 * Event Listener Utama saat Halaman Selesai Dimuat
 */
document.addEventListener("DOMContentLoaded", () => {
  // Sembunyikan Status Bar Android jika berjalan sebagai aplikasi native (Capacitor)
  if (window.Capacitor && window.Capacitor.Plugins) {
    const { StatusBar } = window.Capacitor.Plugins;
    if (StatusBar) {
      StatusBar.hide().catch(err => console.warn("Gagal menyembunyikan status bar:", err));
    }
  }

  // Ambil data saluran pertama kali
  loadStreamingData();

  // Daftarkan event listener untuk kolom pencarian (Real-time Search)
  searchInput.addEventListener("input", handleSearch);

  // Daftarkan event listener untuk perubahan filter (Kategori & Negara)
  categoryFilter.addEventListener("change", handleFilterChange);
  countryFilter.addEventListener("change", handleFilterChange);

  // Daftarkan event listener untuk tombol navigasi halaman (Pagination)
  btnPrev.addEventListener("click", () => changePage(-1));
  btnNext.addEventListener("click", () => changePage(1));

  // Daftarkan event listener untuk tombol coba lagi saat pemutaran video error
  btnRetry.addEventListener("click", retryActiveChannel);

  // Daftarkan event listener untuk tombol refresh API di sidebar
  btnRefreshApi.addEventListener("click", loadStreamingData);

  // Pasang event penanganan status buffer/loading pada pemutar video
  setupVideoEventListeners();

  // Daftarkan event listener untuk tombol navigasi saluran pada video player
  videoNavPrev.addEventListener("click", (e) => {
    e.stopPropagation();
    playPrevChannel();
  });
  videoNavNext.addEventListener("click", (e) => {
    e.stopPropagation();
    playNextChannel();
  });

  // Daftarkan event listener untuk tombol aspek rasio video
  if (videoAspectBtn) {
    videoAspectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      currentAspectIdx = (currentAspectIdx + 1) % aspectRatios.length;
      videoElement.style.objectFit = aspectRatios[currentAspectIdx];
      showVideoToast(`Rasio Gambar: ${aspectRatioLabels[currentAspectIdx]}`);
    });
  }

  // Daftarkan event listener tombol keyboard/remote control
  document.addEventListener("keydown", handleKeyDown);

  // Daftarkan deteksi interaksi sentuhan (swipe) dan hover pada pemutar video
  setupVideoOverlayInteractions();
});

/**
 * Fungsi untuk Mengambil Data dari Tiga Endpoint secara Konkuren
 */
async function loadStreamingData() {
  try {
    // Tampilkan animasi loading sidebar, sembunyikan pesan error
    sidebarLoader.style.display = "flex";
    sidebarError.style.display = "none";
    channelsListContainer.innerHTML = "";
    channelCounter.textContent = "0 Saluran";
    currentPage = 1;

    console.log("Mengambil data streams, channels, dan countries secara paralel...");
    
    // Fetch data secara paralel menggunakan Promise.all
    const [streamsResponse, channelsResponse, countriesResponse] = await Promise.all([
      fetch(STREAMS_API_URL),
      fetch(CHANNELS_API_URL),
      fetch(COUNTRIES_API_URL)
    ]);

    if (!streamsResponse.ok || !channelsResponse.ok || !countriesResponse.ok) {
      throw new Error("Gagal mengambil data dari server IPTV.");
    }

    const streamsData = await streamsResponse.json();
    const channelsData = await channelsResponse.json();
    const countriesData = await countriesResponse.json();

    console.log(`Berhasil mengambil ${streamsData.length} streams, ${channelsData.length} detail saluran, dan ${countriesData.length} kode negara.`);

    // Petakan metadata detail saluran ke dalam Map demi pencarian O(1) yang cepat
    const channelMap = new Map();
    channelsData.forEach(channel => {
      if (channel.id) {
        channelMap.set(channel.id, channel);
      }
    });

    // Petakan negara ke dalam Map demi pencarian O(1)
    const countryMap = new Map();
    countriesData.forEach(country => {
      if (country.code) {
        countryMap.set(country.code.toLowerCase(), country);
      }
    });

    // Jalankan logika proses untuk semua saluran
    processStreamsFlat(streamsData, channelMap, countryMap);

  } catch (error) {
    console.error("Error saat memuat data API:", error);
    sidebarLoader.style.display = "none";
    sidebarError.style.display = "flex";
    showVideoError("Gagal memuat API Saluran. Periksa koneksi internet Anda.");
  }
}

/**
 * Memproses Data Saluran dalam Flat List (Satu Stream = Satu Kartu)
 */
function processStreamsFlat(streams, channelMap, countryMap) {
  allChannels = [];
  const nameCounts = {};
  const categorySet = new Set();
  const countrySet = new Set(); // Menyimpan objek negara unik {code, name}

  streams.forEach(stream => {
    // Abaikan jika stream berstatus error atau tidak ada URL
    if (stream.status === "error" || !stream.url) {
      return;
    }

    const channelMeta = channelMap.get(stream.channel);
    
    // Filter Konten Dewasa (XXX / NSFW) demi keamanan
    if (channelMeta && (channelMeta.is_nsfw === true || (channelMeta.categories && channelMeta.categories.includes("xxx")))) {
      return;
    }

    // Ambil data penting atau set ke default jika tidak ditemukan
    const name = (channelMeta && channelMeta.name) ? channelMeta.name : (stream.channel || "Unknown Channel");
    const categories = (channelMeta && channelMeta.categories) ? channelMeta.categories : [];
    const countryCode = (channelMeta && channelMeta.country) ? channelMeta.country.toLowerCase() : "";
    const logo = (channelMeta && channelMeta.logo) ? channelMeta.logo : "";

    // Kumpulkan kategori unik untuk dropdown filter
    categories.forEach(cat => {
      if (cat && typeof cat === 'string') {
        const cleaned = cat.trim().toLowerCase();
        if (cleaned.length > 0 && cleaned !== "undefined") {
          categorySet.add(cleaned);
        }
      }
    });

    // Kumpulkan negara unik beserta nama lengkapnya
    let countryName = "International";
    if (countryCode) {
      const countryObj = countryMap.get(countryCode);
      if (countryObj) {
        countryName = countryObj.name;
        countrySet.add(JSON.stringify({ code: countryCode, name: countryName }));
      }
    }

    // Hitung resolusi stream (FHD, HD, SD)
    let quality = "SD";
    if (stream.height) {
      if (stream.height >= 1080) quality = "FHD";
      else if (stream.height >= 720) quality = "HD";
    }

    // Modifikasi nama jika duplikat untuk kejelasan visual di daftar
    let finalName = name;
    if (!nameCounts[name]) {
      nameCounts[name] = 1;
    } else {
      nameCounts[name]++;
      finalName = `${name} #${nameCounts[name]}`;
    }

    allChannels.push({
      id: `channel-${stream.channel}-${allChannels.length}`,
      channelId: stream.url,
      name: finalName,
      originalName: name,
      url: stream.url,
      logo: logo,
      country: countryCode,
      countryName: countryName,
      categories: categories,
      quality: quality
    });
  });

  console.log(`Berhasil memuat total ${allChannels.length} saluran aktif.`);

  // Isi dropdown kategori & negara di UI secara dinamis
  populateFilterDropdowns(categorySet, countrySet);
  
  // Matikan spinner pemuatan utama
  sidebarLoader.style.display = "none";
  
  // Terapkan filter pertama kali dan render
  applyFiltersAndRender(true);

  // Otomatis putar saluran pertama jika ada saluran yang lolos filter
  if (filteredChannels.length > 0) {
    playChannel(filteredChannels[0]);
  } else {
    showVideoError("Tidak ada saluran yang cocok ditemukan.");
  }
}

function populateFilterDropdowns(categorySet, countrySet) {
  // 1. Dropdown Kategori (Menyediakan opsi "Favorit Saya" paling atas)
  categoryFilter.innerHTML = `
    <option value="all">Semua Kategori</option>
    <option value="favorites">❤️ Favorit Saya</option>
    <option value="worldcup_schedule">🏆 Jadwal Piala Dunia 2026</option>
  `;
  const sortedCategories = Array.from(categorySet).sort();
  sortedCategories.forEach(cat => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    categoryFilter.appendChild(option);
  });

  // 2. Dropdown Negara
  countryFilter.innerHTML = '<option value="all">Semua Negara</option>';
  const countriesArray = Array.from(countrySet).map(c => JSON.parse(c));
  countriesArray.sort((a, b) => a.name.localeCompare(b.name));

  countriesArray.forEach(country => {
    const option = document.createElement("option");
    option.value = country.code;
    const flag = getFlagEmoji(country.code);
    option.textContent = `${flag} ${country.name}`;
    countryFilter.appendChild(option);
  });
}

/**
 * Menyaring Saluran Berdasarkan Input Cari, Kategori, dan Negara
 */
function applyFiltersAndRender(resetPage = true) {
  if (resetPage) {
    currentPage = 1;
  }

  const query = searchInput.value.toLowerCase().trim();
  const selectedCategory = categoryFilter.value;
  const selectedCountry = countryFilter.value;

  // Intersepsi khusus jika memilih Jadwal Piala Dunia 2026
  if (selectedCategory === "worldcup_schedule") {
    if (sidebarSubBadge) {
      sidebarSubBadge.textContent = "Jadwal Piala Dunia 2026";
    }
    const pag = document.getElementById("pagination-wrapper");
    if (pag) pag.style.display = "none";
    channelCounter.textContent = "Jadwal Pertandingan";
    
    renderWorldCupSchedule();
    return;
  } else {
    const pag = document.getElementById("pagination-wrapper");
    if (pag) pag.style.display = "flex";
  }

  // Perbarui visual sub-badge sidebar
  if (sidebarSubBadge) {
    let badgeText = "Semua Kategori";
    if (selectedCategory === "favorites") {
      badgeText = "Favorit Saya";
    } else if (selectedCategory !== "all") {
      badgeText = selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1);
    }
    if (selectedCountry !== "all") {
      badgeText += ` (${selectedCountry.toUpperCase()})`;
    }
    sidebarSubBadge.textContent = badgeText;
  }

  // Filter gabungan terpadu
  filteredChannels = allChannels.filter(channel => {
    // Filter Kategori (Mendukung filter bookmark favorit)
    let matchesCategory = false;
    if (selectedCategory === "all") {
      matchesCategory = true;
    } else if (selectedCategory === "favorites") {
      matchesCategory = favoriteChannelIds.has(channel.channelId);
    } else {
      matchesCategory = channel.categories && channel.categories.some(cat => cat && cat.toLowerCase() === selectedCategory);
    }
    
    // Filter Negara
    const matchesCountry = (selectedCountry === "all") || 
      (channel.country && channel.country.toLowerCase() === selectedCountry);

    // Filter Kata Kunci Pencarian
    const matchesSearch = (query === "") || 
      (channel.name || "").toLowerCase().includes(query) || 
      (channel.countryName || "").toLowerCase().includes(query) ||
      (channel.country || "").toLowerCase().includes(query);

    return matchesCategory && matchesCountry && matchesSearch;
  });

  // Hitung total halaman
  totalPages = Math.ceil(filteredChannels.length / pageSize);

  // Render halaman saat ini
  renderCurrentPage();
}

/**
 * Render elemen halaman terpilih
 */
function renderCurrentPage() {
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageChannels = filteredChannels.slice(start, end);

  // Kirim data terpotong ke renderer
  renderChannelsList(pageChannels);

  // Perbarui UI Pagination
  updatePaginationControls();
}

/**
 * Perbarui UI pagination (tombol Prev, Next, teks Halaman)
 */
function updatePaginationControls() {
  const displayTotal = totalPages || 1;
  pageIndicator.textContent = `Halaman ${currentPage} / ${displayTotal}`;
  
  btnPrev.disabled = (currentPage === 1);
  btnNext.disabled = (currentPage >= totalPages);
}

/**
 * Pindah Halaman Sebelumnya/Berikutnya
 */
function changePage(direction) {
  const targetPage = currentPage + direction;
  if (targetPage >= 1 && targetPage <= totalPages) {
    currentPage = targetPage;
    renderCurrentPage();
    
    if (channelListScroller) {
      channelListScroller.scrollTop = 0;
    }
  }
}

/**
 * Fungsi untuk Merender daftar saluran ke DOM
 */
function renderChannelsList(channels) {
  channelsListContainer.innerHTML = "";
  
  // Tampilkan total akumulatif saluran yang lolos filter
  channelCounter.textContent = `${filteredChannels.length} Saluran`;

  if (channels.length === 0) {
    channelsListContainer.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <p>Saluran tidak ditemukan.</p>
        <p style="font-size: 11px; margin-top: 5px; color: var(--text-secondary);">Coba penyesuaian filter atau kata kunci lain.</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  channels.forEach(channel => {
    const card = document.createElement("div");
    card.className = "channel-card";
    card.id = channel.id;
    
    // Set status active jika sedang diputar
    if (activeChannel && activeChannel.id === channel.id) {
      card.classList.add("active");
    }

    const initials = channel.originalName ? channel.originalName.substring(0, 2).toUpperCase() : "TV";
    const flagEmoji = getFlagEmoji(channel.country);
    const qualityClass = channel.quality.toLowerCase(); // fhd, hd, sd
    const isFav = favoriteChannelIds.has(channel.channelId);
    const heartIcon = isFav ? 
      `<svg class="heart-icon active" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>` :
      `<svg class="heart-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;

    card.innerHTML = `
      <div class="card-left">
        <div class="card-logo-wrapper">
          ${channel.logo ? 
            `<img src="${channel.logo}" alt="${channel.name}" loading="lazy" onerror="handleImageError(this)">` : 
            `<div class="channel-avatar-placeholder">${initials}</div>`
          }
          <div class="channel-avatar-placeholder" style="display: none;">${initials}</div>
        </div>
        <div class="card-info">
          <div class="card-name">${channel.name}</div>
          <div class="card-meta">
            <span class="card-flag" title="Negara: ${channel.countryName}">${flagEmoji}</span>
            <span class="badge-quality ${qualityClass}">${channel.quality}</span>
            <span class="card-meta-dot"></span>
            <span style="text-transform: capitalize;">${channel.categories.length > 0 ? channel.categories[0] : 'General'}</span>
          </div>
        </div>
      </div>
      <div class="card-right-actions">
        <button class="btn-fav" title="Favorit">
          ${heartIcon}
        </button>
        <div class="card-indicator"></div>
      </div>
    `;

    // Klik tombol favorit
    const btnFav = card.querySelector(".btn-fav");
    btnFav.addEventListener("click", (e) => {
      toggleFavorite(channel.channelId, e);
    });

    // Klik kartu untuk memutar
    card.addEventListener("click", () => {
      if (activeChannel && activeChannel.id === channel.id) return;
      playChannel(channel);
    });

    fragment.appendChild(card);
  });

  channelsListContainer.appendChild(fragment);
}

/**
 * Logika Memutar Saluran dengan Hls.js & Native Fallback
 */
function playChannel(channel) {
  activeChannel = channel;
  console.log(`Memutar: ${channel.name} | URL: ${channel.url}`);

  // 1. Perbarui visual status active di sidebar
  const currentActiveCard = document.querySelector(".channel-card.active");
  if (currentActiveCard) {
    currentActiveCard.classList.remove("active");
  }
  const newActiveCard = document.getElementById(channel.id);
  if (newActiveCard) {
    newActiveCard.classList.add("active");
    newActiveCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 2. Perbarui Metadata Saluran Aktif di UI Utama
  currentChannelName.textContent = channel.name;
  currentChannelCountry.textContent = `${getFlagEmoji(channel.country)} ${channel.countryName.toUpperCase()}`;
  
  const categoryText = channel.categories.length > 0 ? channel.categories.join(", ") : "General";
  currentChannelCategory.textContent = categoryText;
  currentChannelCategory.style.textTransform = "capitalize";

  const initials = channel.originalName ? channel.originalName.substring(0, 2).toUpperCase() : "TV";
  currentLogoContainer.innerHTML = channel.logo ? 
    `<img src="${channel.logo}" alt="${channel.name}" onerror="handleImageError(this)">
     <div class="channel-avatar-placeholder" style="display: none;">${initials}</div>` : 
    `<div class="channel-avatar-placeholder">${initials}</div>`;

  // 3. Tampilkan Loading Video, Sembunyikan Error
  showVideoLoading();

  // 4. Hancurkan instance HLS lama jika ada
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  // 5. Mulai pemutaran video
  const streamUrl = channel.url;

  if (Hls.isSupported()) {
    hlsInstance = new Hls({
      maxMaxBufferLength: 10,
      enableWorker: true,
      lowLatencyMode: true
    });
    
    hlsInstance.loadSource(streamUrl);
    hlsInstance.attachMedia(videoElement);
    
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      videoElement.play().catch(error => {
        console.warn("Autoplay dicegah oleh browser, memerlukan interaksi:", error);
      });
    });

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.warn("Kesalahan Jaringan HLS fatal, mencoba memuat ulang...");
            hlsInstance.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.warn("Kesalahan Media HLS fatal, mencoba pemulihan...");
            hlsInstance.recoverMediaError();
            break;
          default:
            console.error("Kesalahan HLS tidak dapat dipulihkan:", data);
            showVideoError("Gagal menghubungkan ke siaran. Saluran mungkin sedang offline.");
            hlsInstance.destroy();
            hlsInstance = null;
            break;
        }
      }
    });

  } else if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
    // Fallback Native untuk Safari iOS / MacOS
    videoElement.src = streamUrl;
    videoElement.addEventListener("loadedmetadata", () => {
      videoElement.play().catch(error => {
        console.warn("Autoplay Safari dicegah:", error);
      });
    });

    videoElement.onerror = () => {
      showVideoError("Gagal memutar video secara native di perangkat Anda.");
    };
  } else {
    showVideoError("Browser Anda tidak mendukung pemutaran video HLS (.m3u8).");
  }
}

/**
 * Pasang listener pemantau status buffer video player
 */
function setupVideoEventListeners() {
  videoElement.addEventListener("playing", () => {
    hideVideoOverlays();
  });

  videoElement.addEventListener("waiting", () => {
    showVideoLoading("Penyanggaan (Buffering)...");
  });

  videoElement.addEventListener("loadstart", () => {
    showVideoLoading("Menghubungkan...");
  });

  videoElement.addEventListener("error", (e) => {
    if (!hlsInstance && videoElement.error) {
      console.error("HTML5 Video Error:", videoElement.error);
      showVideoError("Gagal memutar siaran. Saluran offline atau format tidak didukung.");
    }
  });
}

/**
 * Menangani Pencarian Real-Time
 */
function handleSearch(event) {
  applyFiltersAndRender(true);
}

/**
 * Menangani Perubahan Filter (Kategori atau Negara)
 */
function handleFilterChange(event) {
  applyFiltersAndRender(true);
}

/**
 * Coba Ulang Saluran Aktif saat Tombol Retry Ditekan
 */
function retryActiveChannel() {
  if (activeChannel) {
    playChannel(activeChannel);
  }
}

/**
 * Penanganan gambar logo saluran yang rusak (404)
 */
function handleImageError(image) {
  image.style.display = "none";
  const placeholder = image.nextElementSibling;
  if (placeholder) {
    placeholder.style.display = "flex";
  }
}

/**
 * Fungsi Konversi Kode Negara 2-Digit ke Flag Emoji
 */
function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map(char => 127397 + char.charCodeAt(0));
  
  try {
    return String.fromCodePoint(...codePoints);
  } catch (e) {
    return "🌐";
  }
}

/**
 * Tampilkan Loading Overlay Video
 */
function showVideoLoading(message = "Menghubungkan...") {
  videoLoadingOverlay.style.display = "flex";
  videoErrorOverlay.style.display = "none";
  videoLoadingOverlay.querySelector(".overlay-text").textContent = message;
}

/**
 * Tampilkan Error Overlay Video
 */
function showVideoError(message) {
  videoLoadingOverlay.style.display = "none";
  videoErrorOverlay.style.display = "flex";
  videoErrorOverlay.querySelector(".error-msg").textContent = message;
}

/**
 * Sembunyikan Overlay Player
 */
function hideVideoOverlays() {
  videoLoadingOverlay.style.display = "none";
  videoErrorOverlay.style.display = "none";
}

/**
 * Memutar Saluran Berikutnya (Next) pada Daftar Saringan Aktif
 */
function playNextChannel() {
  if (filteredChannels.length === 0) return;
  
  let currentIndex = -1;
  if (activeChannel) {
    currentIndex = filteredChannels.findIndex(c => c.id === activeChannel.id);
  }
  
  const nextIndex = (currentIndex + 1) % filteredChannels.length;
  const nextChannel = filteredChannels[nextIndex];
  
  // Sinkronisasi halaman pagination jika saluran berada di luar halaman saat ini
  const targetPage = Math.floor(nextIndex / pageSize) + 1;
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    renderCurrentPage();
  }
  
  playChannel(nextChannel);
  showVideoToast(`Beralih ke: ${nextChannel.name}`);
}

/**
 * Memutar Saluran Sebelumnya (Prev) pada Daftar Saringan Aktif
 */
function playPrevChannel() {
  if (filteredChannels.length === 0) return;
  
  let currentIndex = -1;
  if (activeChannel) {
    currentIndex = filteredChannels.findIndex(c => c.id === activeChannel.id);
  }
  
  const prevIndex = (currentIndex - 1 + filteredChannels.length) % filteredChannels.length;
  const prevChannel = filteredChannels[prevIndex];
  
  // Sinkronisasi halaman pagination jika saluran berada di luar halaman saat ini
  const targetPage = Math.floor(prevIndex / pageSize) + 1;
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    renderCurrentPage();
  }
  
  playChannel(prevChannel);
  showVideoToast(`Beralih ke: ${prevChannel.name}`);
}

/**
 * Menangani Input Keydown Keyboard/Remote Control untuk Pindah Saluran
 */
function handleKeyDown(event) {
  // Hanya picu ganti saluran jika pengguna tidak sedang mengetik di kolom pencarian
  if (document.activeElement === searchInput) {
    return;
  }
  
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
      event.preventDefault();
      playNextChannel();
      break;
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      event.preventDefault();
      playPrevChannel();
      break;
  }
}

/**
 * Mengatur Interaksi Gesture Sentuh (Swipe) & Autohide Tombol Overlay di Pemutar
 */
function setupVideoOverlayInteractions() {
  let controlsTimeout = null;

  // Fungsi untuk menampilkan overlay navigasi saluran
  function showControlsTemporarily() {
    videoWrapper.classList.add("show-controls");
    
    if (controlsTimeout) {
      clearTimeout(controlsTimeout);
    }
    
    // Sembunyikan kembali setelah 3 detik tidak ada aktivitas sentuhan
    controlsTimeout = setTimeout(() => {
      videoWrapper.classList.remove("show-controls");
    }, 3000);
  }

  // Picu saat menyentuh video di perangkat seluler / Android
  videoWrapper.addEventListener("touchstart", showControlsTemporarily, { passive: true });
  videoWrapper.addEventListener("mousemove", showControlsTemporarily, { passive: true });

  // Deteksi gesture swipe pada pemutar video
  let touchStartX = 0;
  let touchStartY = 0;

  videoElement.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  videoElement.addEventListener("touchend", (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    
    // Swipe horizontal valid jika pergeseran X > 70px dan pergeseran vertikal Y < 50px
    if (Math.abs(diffX) > 70 && Math.abs(diffY) < 50) {
      if (diffX < 0) {
        // Geser ke kiri -> Saluran berikutnya
        playNextChannel();
      } else {
        // Geser ke kanan -> Saluran sebelumnya
        playPrevChannel();
      }
    }
  }, { passive: true });
}

/**
 * Menampilkan Toast Notifikasi Pergantian Saluran di Layar Video
 */
function showVideoToast(message) {
  if (!videoToast) return;
  
  videoToast.textContent = message;
  
  // Hapus class show dan picu reflow untuk me-restart transisi CSS animasi fade-in/out
  videoToast.classList.remove("show");
  void videoToast.offsetWidth;
  videoToast.classList.add("show");
  
  if (videoToast.timeoutId) {
    clearTimeout(videoToast.timeoutId);
  }
  
  // Sembunyikan toast setelah 2 detik
  videoToast.timeoutId = setTimeout(() => {
    videoToast.classList.remove("show");
  }, 2000);
}

/**
 * Mengubah status favorit saluran (ditambahkan/dihapus)
 */
function toggleFavorite(channelId, event) {
  if (event) {
    event.stopPropagation(); // Mencegah pemutaran saluran terpicu secara tidak sengaja
  }
  
  if (favoriteChannelIds.has(channelId)) {
    favoriteChannelIds.delete(channelId);
    showVideoToast("Dihapus dari Favorit ❤️");
  } else {
    favoriteChannelIds.add(channelId);
    showVideoToast("Ditambahkan ke Favorit ❤️");
  }
  
  // Simpan data secara permanen ke localStorage
  localStorage.setItem("tv_favorites", JSON.stringify(Array.from(favoriteChannelIds)));
  
  // Jika filter kategori aktif adalah 'favorites', kita harus merender ulang daftar saringan
  if (categoryFilter.value === "favorites") {
    applyFiltersAndRender(false);
    
    // Sesuaikan halaman jika halaman saat ini kosong setelah saluran dihapus
    if (currentPage > totalPages) {
      currentPage = Math.max(1, totalPages);
      renderCurrentPage();
    }
  } else {
    // Rendel ulang halaman saat ini untuk memperbarui icon hati
    renderCurrentPage();
  }
}

/**
 * Merender Jadwal Pertandingan Piala Dunia 2026 (WIB / GMT+7) ke Kontainer Sidebar
 */
function renderWorldCupSchedule() {
  channelsListContainer.innerHTML = "";
  
  // Data Jadwal Piala Dunia 2026 (Pertengahan Juni 2026 - Waktu Indonesia Barat)
  const scheduleData = [
    { date: "Senin, 15 Juni 2026", time: "05:00 WIB", team1: "Argentina", flag1: "🇦🇷", team2: "Australia", flag2: "🇦🇺", group: "Grup C", status: "Selesai" },
    { date: "Senin, 15 Juni 2026", time: "08:00 WIB", team1: "Prancis", flag1: "🇫🇷", team2: "Korea Selatan", flag2: "🇰🇷", group: "Grup D", status: "Selesai" },
    { date: "Senin, 15 Juni 2026", time: "23:00 WIB", team1: "Spanyol", flag1: "🇪🇸", team2: "Kamerun", flag2: "🇨🇲", group: "Grup E", status: "Akan Datang" },
    { date: "Selasa, 16 Juni 2026", time: "04:00 WIB", team1: "Brasil", flag1: "🇧🇷", team2: "Polandia", flag2: "🇵🇱", group: "Grup A", status: "Akan Datang" },
    { date: "Selasa, 16 Juni 2026", time: "07:00 WIB", team1: "Inggris", flag1: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", team2: "Jepang", flag2: "🇯🇵", group: "Grup B", status: "Akan Datang" },
    { date: "Selasa, 16 Juni 2026", time: "10:00 WIB", team1: "Jerman", flag1: "🇩🇪", team2: "Ekuador", flag2: "🇪🇨", group: "Grup F", status: "Akan Datang" },
    { date: "Rabu, 17 Juni 2026", time: "05:00 WIB", team1: "Portugal", flag1: "🇵🇹", team2: "Iran", flag2: "🇮🇷", group: "Grup H", status: "Akan Datang" },
    { date: "Rabu, 17 Juni 2026", time: "08:00 WIB", team1: "Belanda", flag1: "🇳🇱", team2: "Tunisia", flag2: "🇹🇳", group: "Grup C", status: "Akan Datang" },
    { date: "Rabu, 17 Juni 2026", time: "11:00 WIB", team1: "Kanada", flag1: "🇨🇦", team2: "Maroko", flag2: "🇲🇦", group: "Grup A", status: "Akan Datang" },
    { date: "Kamis, 18 Juni 2026", time: "06:00 WIB", team1: "Belgia", flag1: "🇧🇪", team2: "Peru", flag2: "🇵🇪", group: "Grup E", status: "Akan Datang" },
    { date: "Kamis, 18 Juni 2026", time: "09:00 WIB", team1: "Kroasia", flag1: "🇭🇷", team2: "Meksiko", flag2: "🇲🇽", group: "Grup B", status: "Akan Datang" }
  ];

  const wrapper = document.createElement("div");
  wrapper.className = "schedule-list-wrapper";

  scheduleData.forEach(match => {
    const card = document.createElement("div");
    card.className = "schedule-card";
    
    let statusClass = "status-upcoming";
    if (match.status === "Selesai") {
      statusClass = "status-ended";
    } else if (match.status === "LIVE") {
      statusClass = "status-live";
    }

    card.innerHTML = `
      <div class="schedule-header">
        <span class="schedule-group">${match.group}</span>
        <span class="schedule-status ${statusClass}">${match.status}</span>
      </div>
      <div class="schedule-body">
        <div class="schedule-team">
          <span class="schedule-flag">${match.flag1}</span>
          <span class="schedule-team-name">${match.team1}</span>
        </div>
        <div class="schedule-vs">VS</div>
        <div class="schedule-team">
          <span class="schedule-flag">${match.flag2}</span>
          <span class="schedule-team-name">${match.team2}</span>
        </div>
      </div>
      <div class="schedule-footer">
        <div class="schedule-time-info">
          📅 ${match.date} &nbsp;|&nbsp; ⏰ ${match.time}
        </div>
        ${match.status !== "Selesai" ? `
          <button class="btn-watch-now" title="Tonton Siaran Langsung">
            📺 Tonton
          </button>
        ` : ""}
      </div>
    `;

    // Tombol "Tonton" otomatis mencarikan siaran live dengan kata kunci nama tim
    if (match.status !== "Selesai") {
      const btnWatch = card.querySelector(".btn-watch-now");
      btnWatch.addEventListener("click", () => {
        categoryFilter.value = "all";
        searchInput.value = match.team1;
        applyFiltersAndRender();
        showVideoToast(`Mencari saluran: ${match.team1}`);
      });
    }

    wrapper.appendChild(card);
  });

  channelsListContainer.appendChild(wrapper);
}

