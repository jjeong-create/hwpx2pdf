/**
 * HWPX to PDF client-side converter logic
 * Uses JSZip to extract OWPML XMLs and images,
 * translates character/paragraph styles to standard HTML/CSS,
 * renders a responsive high-fidelity live preview,
 * and compiles multi-page PDFs locally using html2pdf.js.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // DOM Elements
  const themeToggle = document.getElementById('themeToggle');
  const themeIconSun = document.getElementById('themeIconSun');
  const themeIconMoon = document.getElementById('themeIconMoon');

  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const metadataCard = document.getElementById('metadataCard');
  const metaFileName = document.getElementById('metaFileName');
  const metaFileSize = document.getElementById('metaFileSize');

  const progressStatus = document.getElementById('progressStatus');
  const progressPercent = document.getElementById('progressPercent');
  const progressBar = document.getElementById('progressBar');
  const logConsole = document.getElementById('logConsole');

  const tabPreview = document.getElementById('tabPreview');
  const tabSource = document.getElementById('tabSource');
  const emptyViewer = document.getElementById('emptyViewer');
  const documentPage = document.getElementById('documentPage');
  const sourcePage = document.getElementById('sourcePage');
  const renderOutput = document.getElementById('renderOutput');
  const sourceOutput = document.getElementById('sourceOutput');

  const scaleSlider = document.getElementById('scaleSlider');
  const scaleValue = document.getElementById('scaleValue');
  const btnDownload = document.getElementById('btnDownload');
  
  // New Action & Security Controls
  const watermarkInput = document.getElementById('watermarkInput');
  const passwordInput = document.getElementById('passwordInput');
  const btnCopyText = document.getElementById('btnCopyText');
  const btnPrint = document.getElementById('btnPrint');

  // Parser State
  let activeZip = null;
  let activeParsedHtml = '';
  let activeFileName = '';
  let mediaMap = {};      // Maps binData ID (e.g. BIN1) to internal ZIP file path
  let charPrMap = {};     // Character style configurations
  let paraPrMap = {};     // Paragraph style configurations

  // Namespace-agnostic element finder (resolves DOMParser namespace handling bugs)
  function getElementsByLocalName(targetNode, localName) {
    if (!targetNode) return [];
    let elements = targetNode.getElementsByTagNameNS('*', localName);
    if (elements.length === 0) {
      elements = targetNode.getElementsByTagName(localName);
    }
    if (elements.length === 0) {
      const all = targetNode.getElementsByTagName('*');
      const filtered = [];
      for (let el of all) {
        if (el.localName === localName) {
          filtered.push(el);
        }
      }
      return filtered;
    }
    return Array.from(elements);
  }

  // 1. Dark/Light Theme Handler
  let currentTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcon(currentTheme);

  themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
    updateThemeIcon(currentTheme);
    addLog(`테마가 ${currentTheme === 'dark' ? '다크 모드' : '라이트 모드'}로 변경되었습니다.`, 'info');
  });

  function updateThemeIcon(theme) {
    if (theme === 'dark') {
      themeIconSun.classList.remove('hidden-pdf-source');
      themeIconMoon.classList.add('hidden-pdf-source');
    } else {
      themeIconSun.classList.add('hidden-pdf-source');
      themeIconMoon.classList.remove('hidden-pdf-source');
    }
  }

  // 2. Drag & Drop Event Listeners
  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });

  // Scale Slider Handler
  scaleSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    scaleValue.textContent = `${val}%`;
    documentPage.style.transform = `scale(${val / 100})`;
  });

  // Tab Selector Handler
  tabPreview.addEventListener('click', () => {
    tabPreview.classList.add('active');
    tabSource.classList.remove('active');
    if (activeParsedHtml) {
      documentPage.classList.remove('hidden-pdf-source');
      emptyViewer.classList.add('hidden-pdf-source');
    } else {
      emptyViewer.classList.remove('hidden-pdf-source');
    }
    sourcePage.classList.add('hidden-pdf-source');
  });

  tabSource.addEventListener('click', () => {
    tabSource.classList.add('active');
    tabPreview.classList.remove('active');
    documentPage.classList.add('hidden-pdf-source');
    emptyViewer.classList.add('hidden-pdf-source');
    sourcePage.classList.remove('hidden-pdf-source');
  });

  // 3. Logger & Progress Helpers
  function addLog(text, type = 'info') {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const timeStr = `[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
    
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = timeStr;
    
    const textSpan = document.createElement('span');
    textSpan.className = `log-text ${type}`;
    textSpan.textContent = text;
    
    entry.appendChild(timeSpan);
    entry.appendChild(textSpan);
    logConsole.appendChild(entry);
    
    // Auto scroll to bottom
    logConsole.scrollTop = logConsole.scrollHeight;
  }

  function updateProgress(status, percent) {
    progressStatus.textContent = status;
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 4. Main Document Processing Selection Flow
  async function handleFileSelection(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'hwpx' && ext !== 'docx') {
      addLog('오류: HWPX 및 DOCX 파일 포맷만 지원합니다.', 'error');
      alert('HWPX 및 DOCX 형식의 파일만 변환할 수 있습니다.');
      return;
    }

    activeFileName = file.name.substring(0, file.name.lastIndexOf('.'));
    activeParsedHtml = '';
    metaFileName.textContent = file.name;
    metaFileSize.textContent = formatBytes(file.size);
    metadataCard.classList.remove('hidden-pdf-source');
    
    // Reset view panels
    renderOutput.innerHTML = '';
    sourceOutput.textContent = '';
    btnDownload.disabled = true;
    btnCopyText.disabled = true;
    btnPrint.disabled = true;

    if (ext === 'docx') {
      await handleDocxFile(file);
    } else {
      await handleHwpxFile(file);
    }
  }

  // 4.1 DOCX Processing Flow via Mammoth.js
  async function handleDocxFile(file) {
    try {
      updateProgress('DOCX 파일 읽는 중...', 20);
      addLog(`DOCX 워드 파일 분석 시작: ${file.name}`, 'info');

      const arrayBuffer = await file.arrayBuffer();
      updateProgress('HTML 구조 변환 중...', 50);
      addLog('Mammoth.js를 사용하여 DOCX를 HTML로 로컬 변환 중...', 'working');

      const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
      activeParsedHtml = result.value;

      if (result.messages && result.messages.length > 0) {
        addLog(`변환 경고: ${result.messages.map(m => m.message).join(', ')}`, 'info');
      }

      // Display
      renderOutput.innerHTML = activeParsedHtml;
      sourceOutput.textContent = formatHTMLSource(activeParsedHtml);

      emptyViewer.classList.add('hidden-pdf-source');
      documentPage.classList.remove('hidden-pdf-source');

      updateProgress('변환 완료', 100);
      addLog('성공: DOCX 문서 레이아웃이 성공적으로 번역되었습니다!', 'success');
      btnDownload.disabled = false;
      btnCopyText.disabled = false;
      btnPrint.disabled = false;
    } catch (err) {
      console.error(err);
      addLog(`DOCX 변환 오류: ${err.message}`, 'error');
      updateProgress('변환 실패', 0);
      alert('DOCX 워드 파일을 변환하는 데 실패했습니다.');
    }
  }

  // 4.2 HWPX Processing Flow
  async function handleHwpxFile(file) {
    try {
      updateProgress('압축 해제 준비 중...', 10);
      addLog(`HWPX 압축 파일 로드 시작: ${file.name}`, 'info');

      // Load Zip Container
      const zip = await JSZip.loadAsync(file);
      activeZip = zip;
      addLog('성공적으로 ZIP 아카이브를 로드했습니다.', 'success');
      updateProgress('문서 리소스 분석 중...', 25);

      // Parse Manifest (content.hpf) to map media files
      await parseManifest(zip);
      updateProgress('스타일 템플릿 파싱 중...', 45);

      // Parse Styles (header.xml)
      await parseStyles(zip);
      updateProgress('문서 본문 렌더링 중...', 70);

      // Parse Section XMLs (section0.xml, etc.)
      await parseSections(zip);

    } catch (err) {
      console.error(err);
      addLog(`파싱 오류 발생: ${err.message}`, 'error');
      updateProgress('변환 실패', 0);
      alert('HWPX 파일을 파싱하는 데 실패했습니다. 파일이 손상되었거나 지원하지 않는 구조입니다.');
    }
  }

  // 5. HPF Manifest Parser (Extracting Media/BinData references)
  async function parseManifest(zip) {
    // Find the file ending with .hpf
    const hpfFile = Object.keys(zip.files).find(name => name.toLowerCase().endsWith('.hpf'));
    if (!hpfFile) {
      addLog('경고: content.hpf 파일을 찾을 수 없습니다. 미디어 참조에 오류가 발생할 수 있습니다.', 'error');
      return;
    }

    addLog(`패키지 메니페스트 분석 중: ${hpfFile}`, 'working');
    const hpfText = await zip.file(hpfFile).async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(hpfText, 'text/xml');

    mediaMap = {};
    const items = getElementsByLocalName(doc, 'item');
    for (let item of items) {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (id && href) {
        // Handle path offsets inside zip structure
        mediaMap[id] = href;
      }
    }
    addLog(`총 ${Object.keys(mediaMap).length}개의 미디어 리소스 매핑을 확보했습니다.`, 'success');
  }

  // 6. Header XML Style Parser (Font sizes, color themes, spacing)
  async function parseStyles(zip) {
    const headerFile = Object.keys(zip.files).find(name => name.toLowerCase().endsWith('header.xml'));
    if (!headerFile) {
      addLog('경고: header.xml 스타일 정의를 찾을 수 없습니다. 기본값 스타일로 렌더링합니다.', 'error');
      return;
    }

    addLog(`스타일 명세서 로드 중: ${headerFile}`, 'working');
    const headerText = await zip.file(headerFile).async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(headerText, 'text/xml');

    // Parse Character Properties (charPr)
    charPrMap = {};
    const charProperties = getElementsByLocalName(doc, 'charPr');
    for (let charPr of charProperties) {
      const id = charPr.getAttribute('id');
      if (!id) continue;

      const height = charPr.getAttribute('height');
      const textColor = charPr.getAttribute('textColor');

      // Check both attributes and nested element structures
      let isBold = charPr.getAttribute('bold') === '1' || charPr.getAttribute('bold') === 'true';
      let isItalic = charPr.getAttribute('italic') === '1' || charPr.getAttribute('italic') === 'true';
      let isUnderline = charPr.getAttribute('underline') === '1' || charPr.getAttribute('underline') === 'true';
      let isStrikeout = charPr.getAttribute('strikeout') === '1' || charPr.getAttribute('strikeout') === 'true';

      // Extract formatting elements ignoring namespace
      for (let child of charPr.children) {
        const lname = child.localName.toLowerCase();
        const valAttr = child.getAttribute('val');
        const hasFalseVal = valAttr === '0' || valAttr === 'false' || valAttr === 'no';
        if (lname === 'bold') isBold = !hasFalseVal;
        if (lname === 'italic') isItalic = !hasFalseVal;
        if (lname === 'underline') isUnderline = !hasFalseVal;
        if (lname === 'strikeout') isStrikeout = !hasFalseVal;
      }

      charPrMap[id] = {
        fontSize: height ? `${parseInt(height, 10) / 100}pt` : null,
        color: parseColor(textColor),
        bold: isBold,
        italic: isItalic,
        underline: isUnderline,
        strikeout: isStrikeout
      };
    }

    // Parse Paragraph Properties (paraPr)
    paraPrMap = {};
    const paraProperties = getElementsByLocalName(doc, 'paraPr');
    for (let paraPr of paraProperties) {
      const id = paraPr.getAttribute('id');
      if (!id) continue;

      let textAlign = 'left';
      let lineHeight = '1.6';

      // Look inside children of paraPr
      for (let child of paraPr.children) {
        const lname = child.localName.toLowerCase();
        if (lname === 'align') {
          const hAlign = child.getAttribute('horizontal');
          if (hAlign) {
            const mappedAlign = hAlign.toUpperCase();
            if (mappedAlign === 'CENTER') textAlign = 'center';
            else if (mappedAlign === 'RIGHT') textAlign = 'right';
            else if (mappedAlign === 'JUSTIFY') textAlign = 'justify';
            else if (mappedAlign === 'DISTRIBUTED') textAlign = 'justify'; // Full spacing fallback
            else textAlign = 'left';
          }
        } else if (lname === 'linespacing') {
          const type = child.getAttribute('type');
          const value = child.getAttribute('value');
          if (value) {
            const valNum = parseFloat(value);
            if (type === 'PERCENT') {
              if (valNum > 10) {
                lineHeight = (valNum / 100).toString();
              } else {
                lineHeight = valNum.toString();
              }
            } else if (type === 'FIXED') {
              // FIXED value is in HWPUNIT (100 HWPUNIT = 1pt)
              lineHeight = `${valNum / 100}pt`;
            }
          }
        }
      }

      paraPrMap[id] = {
        textAlign: textAlign,
        lineHeight: lineHeight
      };
    }

    addLog(`글자 모양(${Object.keys(charPrMap).length}개), 문단 모양(${Object.keys(paraPrMap).length}개) 목록 빌드 완료.`, 'success');
  }

  // Helper color parsing
  function parseColor(val) {
    if (!val) return null;
    val = val.trim();
    if (val.startsWith('#')) return val;
    if (!isNaN(val)) {
      const num = parseInt(val, 10);
      // ARGB integer unpack. Mask off alpha and capture RGB values
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      return `rgb(${r}, ${g}, ${b})`;
    }
    return val;
  }

  // 7. Section Content Parser (Combining pages and assembling final HTML)
  async function parseSections(zip) {
    // Collect all section XML files and sort them (e.g. Contents/section0.xml, Contents/section1.xml...)
    const sectionFiles = Object.keys(zip.files)
      .filter(name => name.toLowerCase().includes('section') && name.toLowerCase().endsWith('.xml'))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });

    if (sectionFiles.length === 0) {
      throw new Error('이 문서 안에 텍스트 섹션(section.xml)이 존재하지 않습니다.');
    }

    addLog(`총 ${sectionFiles.length}개의 본문 섹션을 감지하여 순차 해석합니다...`, 'working');
    
    // Create a temporary layout container to hold compiled HTML
    const finalContainer = document.createElement('div');
    finalContainer.className = 'hwpx-rendered-content';

    for (let secFile of sectionFiles) {
      addLog(`해석 중: ${secFile}`, 'working');
      const text = await zip.file(secFile).async('string');
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      
      // Parse body node recursively (fallback to section or document root element to support all HWPX schemas)
      const bodyNode = getElementsByLocalName(doc, 'body')[0] || 
                       getElementsByLocalName(doc, 'section')[0] || 
                       doc.documentElement;
      if (bodyNode) {
        await parseDOMNode(bodyNode, finalContainer);
      }
    }

    // Extract HTML output
    activeParsedHtml = finalContainer.innerHTML;

    // Display parsed document
    renderOutput.innerHTML = activeParsedHtml;
    sourceOutput.textContent = formatHTMLSource(activeParsedHtml);

    // Update View Panels
    emptyViewer.classList.add('hidden-pdf-source');
    documentPage.classList.remove('hidden-pdf-source');
    
    // Re-verify layouts and enable PDF action buttons
    updateProgress('변환 완료', 100);
    addLog(`성공: 모든 문서 레이아웃이 성공적으로 번역되었습니다!`, 'success');
    btnDownload.disabled = false;
    btnCopyText.disabled = false;
    btnPrint.disabled = false;
  }

  // 8. Recursive DOM Translator (Translating XML tags to HTML tags & loading inline style blobs)
  async function parseDOMNode(xmlNode, htmlParentNode) {
    if (xmlNode.nodeType === 3) { // Text Node
      const text = xmlNode.nodeValue.trim();
      if (text) {
        htmlParentNode.appendChild(document.createTextNode(xmlNode.nodeValue));
      }
      return;
    }

    if (xmlNode.nodeType !== 1) return; // Ignore other types

    const lname = xmlNode.localName.toLowerCase();
    
    if (lname === 'p') {
      const p = document.createElement('p');
      
      // Apply style template (paraPr)
      const paraPrIDRef = xmlNode.getAttribute('paraPrIDRef');
      if (paraPrIDRef && paraPrMap[paraPrIDRef]) {
        const style = paraPrMap[paraPrIDRef];
        p.style.textAlign = style.textAlign;
        p.style.lineHeight = style.lineHeight;
      }
      
      // Process children
      for (let child of xmlNode.childNodes) {
        await parseDOMNode(child, p);
      }
      
      htmlParentNode.appendChild(p);
      return;
    }

    if (lname === 'run') {
      const span = document.createElement('span');
      
      // Apply character styling rules
      const charPrIDRef = xmlNode.getAttribute('charPrIDRef');
      if (charPrIDRef && charPrMap[charPrIDRef]) {
        const style = charPrMap[charPrIDRef];
        if (style.fontSize) span.style.fontSize = style.fontSize;
        if (style.color) span.style.color = style.color;
        if (style.bold) span.style.fontWeight = 'bold';
        if (style.italic) span.style.fontStyle = 'italic';
        
        // Handle multiple decoration types
        let decorations = [];
        if (style.underline) decorations.push('underline');
        if (style.strikeout) decorations.push('line-through');
        if (decorations.length > 0) {
          span.style.textDecoration = decorations.join(' ');
        }
      }
      
      // Process children
      for (let child of xmlNode.childNodes) {
        await parseDOMNode(child, span);
      }
      
      htmlParentNode.appendChild(span);
      return;
    }

    if (lname === 't') {
      // Direct inner text holder
      for (let child of xmlNode.childNodes) {
        await parseDOMNode(child, htmlParentNode);
      }
      return;
    }

    if (lname === 'tbl') {
      const table = document.createElement('table');
      // Set table border properties
      table.style.borderCollapse = 'collapse';
      table.style.width = '100%';
      
      for (let child of xmlNode.childNodes) {
        await parseDOMNode(child, table);
      }
      
      htmlParentNode.appendChild(table);
      return;
    }

    if (lname === 'tr') {
      const tr = document.createElement('tr');
      
      for (let child of xmlNode.childNodes) {
        await parseDOMNode(child, tr);
      }
      
      htmlParentNode.appendChild(tr);
      return;
    }

    if (lname === 'tc') {
      const td = document.createElement('td');
      
      // Copy spans for column/row adjustments
      const colSpan = xmlNode.getAttribute('colSpan');
      if (colSpan) td.colSpan = parseInt(colSpan, 10);
      
      const rowSpan = xmlNode.getAttribute('rowSpan');
      if (rowSpan) td.rowSpan = parseInt(rowSpan, 10);
      
      for (let child of xmlNode.childNodes) {
        await parseDOMNode(child, td);
      }
      
      htmlParentNode.appendChild(td);
      return;
    }

    if (lname === 'pic') {
      const img = document.createElement('img');
      const binID = findBinDataId(xmlNode);
      
      if (binID) {
        let fileEntry = null;
        let cleanPath = "";
        
        // 1. Try case-insensitive lookup in mediaMap
        let rawPath = null;
        const lookupID = binID.toLowerCase();
        for (let key of Object.keys(mediaMap)) {
          if (key.toLowerCase() === lookupID) {
            rawPath = mediaMap[key];
            break;
          }
        }

        if (rawPath) {
          cleanPath = rawPath.startsWith('/') ? rawPath.substring(1) : rawPath;
          fileEntry = activeZip.file(cleanPath) || activeZip.file(`Contents/${cleanPath}`);
          if (!fileEntry) {
            const zipKeys = Object.keys(activeZip.files);
            const matchedKey = zipKeys.find(key => key.toLowerCase().endsWith(cleanPath.toLowerCase()));
            if (matchedKey) {
              fileEntry = activeZip.file(matchedKey);
            }
          }
        }

        // 2. FALLBACK: Search ZIP directly by the ID filename (case-insensitive fuzzy match)
        if (!fileEntry) {
          const zipKeys = Object.keys(activeZip.files);
          const matchedKey = zipKeys.find(key => {
            const kLower = key.toLowerCase();
            return kLower.includes('bindata/') && kLower.includes(lookupID);
          });
          if (matchedKey) {
            fileEntry = activeZip.file(matchedKey);
            cleanPath = matchedKey;
            addLog(`메니페스트 유실 이미지 직접 매칭 성공: ${matchedKey}`, 'info');
          }
        }

        // 3. FALLBACK: Match by index based on sorting if ID is numeric (e.g. "1", "2")
        if (!fileEntry) {
          const numMatch = binID.match(/\d+/);
          if (numMatch) {
            const idx = parseInt(numMatch[0], 10) - 1; // 0-indexed
            const binDataFiles = Object.keys(activeZip.files)
              .filter(key => key.toLowerCase().includes('bindata/'))
              .sort();
            if (binDataFiles[idx]) {
              const matchedKey = binDataFiles[idx];
              fileEntry = activeZip.file(matchedKey);
              cleanPath = matchedKey;
              addLog(`인덱스 기반 이미지 매칭 성공: ${matchedKey}`, 'info');
            }
          }
        }

        if (fileEntry) {
          try {
            const base64 = await fileEntry.async('base64');
            const mimeType = getMimeType(cleanPath);
            img.src = `data:${mimeType};base64,${base64}`;
            img.alt = `Embedded image ${binID}`;
            htmlParentNode.appendChild(img);
            addLog(`이미지 리소스 복원 완료: ${cleanPath}`, 'info');
          } catch (e) {
            addLog(`이미지 해독 실패: ${cleanPath}`, 'error');
          }
        } else {
          addLog(`경고: 미디어 참조를 찾을 수 없습니다: ${binID}`, 'error');
        }
      }
      return;
    }

    // Fallback: Continue traversal for generic structural nodes (body, section, etc.)
    for (let child of xmlNode.childNodes) {
      await parseDOMNode(child, htmlParentNode);
    }
  }

  // Recursively search children for image binary IDs
  function findBinDataId(picNode) {
    if (!picNode || !picNode.attributes) return null;
    for (let attr of picNode.attributes) {
      const name = attr.name.toLowerCase();
      if (name.includes('bindataid') || name.includes('refbindata') || name.includes('binid') || name.includes('ref')) {
        return attr.value;
      }
    }
    if (picNode.children) {
      for (let child of picNode.children) {
        const id = findBinDataId(child);
        if (id) return id;
      }
    }
    return null;
  }

  function getMimeType(path) {
    const ext = path.toLowerCase().split('.').pop();
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'svg') return 'image/svg+xml';
    return 'image/png'; // Safe fallback
  }

  // Prettify HTML source output
  function formatHTMLSource(html) {
    let formatted = '';
    let reg = /(>)(<)(\/*)/g;
    html = html.replace(reg, '$1\r\n$2$3');
    let pad = 0;
    html.split('\r\n').forEach(line => {
      let indent = 0;
      if (line.match(/.+<\/\w[^>]*>$/)) {
        indent = 0;
      } else if (line.match(/^<\/\w/)) {
        if (pad !== 0) {
          pad -= 1;
        }
      } else if (line.match(/^<\w[^>]*[^\/]>$/)) {
        indent = 1;
      } else {
        indent = 0;
      }

      let padding = '';
      for (let i = 0; i < pad; i++) {
        padding += '  ';
      }
      formatted += padding + line + '\r\n';
      pad += indent;
    });
    return formatted.trim();
  }

  // 9. html2pdf local printing compilation engine
  btnDownload.addEventListener('click', async () => {
    if (!activeParsedHtml) return;

    btnDownload.disabled = true;
    updateProgress('PDF 파일 출력 중...', 80);
    addLog('PDF 레이아웃 조율 및 파일 컴파일 진행 중...', 'working');

    // Create dynamic high-resolution A4 container to prevent viewport overrides
    const printContainer = document.createElement('div');
    printContainer.className = 'hwpx-rendered-content';
    printContainer.style.background = '#ffffff';
    printContainer.style.color = '#1e293b';
    printContainer.style.width = '800px';
    printContainer.style.padding = '50px 60px';
    printContainer.style.fontFamily = 'Inter, "Noto Sans KR", sans-serif';
    printContainer.style.position = 'relative';
    printContainer.style.minHeight = '1000px';
    printContainer.innerHTML = activeParsedHtml;
    
    // Inject watermark overlay if specified
    const watermarkText = watermarkInput ? watermarkInput.value.trim() : '';
    if (watermarkText) {
      const wOverlay = document.createElement('div');
      wOverlay.className = 'watermark-overlay';
      wOverlay.textContent = watermarkText;
      printContainer.appendChild(wOverlay);
    }
    
    // Inject static frozen timestamp footer in printed document
    const printTimestamp = document.createElement('div');
    printTimestamp.className = 'timestamp-watermark';
    printTimestamp.textContent = formatDateTime(new Date());
    printContainer.appendChild(printTimestamp);
    
    // Inject print styling variables
    document.body.appendChild(printContainer);

    const resolutionSelect = document.getElementById('resolutionSelect');
    const qualityMode = resolutionSelect ? resolutionSelect.value : 'medium';
    
    let scaleVal = 2.0;
    let qualityVal = 0.8;
    
    if (qualityMode === 'high') {
      scaleVal = 2.8;
      qualityVal = 0.98;
      addLog('출력 설정: 고해상도 인쇄 품질 (HD) - 선명한 텍스트 및 대용량', 'info');
    } else if (qualityMode === 'low') {
      scaleVal = 1.3;
      qualityVal = 0.55;
      addLog('출력 설정: 용량 초절약 압축 (Compressed) - 효율적인 모바일 전송 및 초저용량', 'info');
    } else {
      scaleVal = 2.0;
      qualityVal = 0.8;
      addLog('출력 설정: 표준 밸런스 화질 (Standard) - 일반 웹 공유용 균형 품질', 'info');
    }

    const passwordText = passwordInput ? passwordInput.value : '';

    const jsPdfOpts = { unit: 'mm', format: 'a4', orientation: 'portrait' };
    if (passwordText) {
      addLog('PDF 보안 알고리즘 연동: 128비트 RC4 비밀번호 보호 락 적용 중...', 'working');
      jsPdfOpts.encryption = {
        userPassword: passwordText,
        ownerPassword: passwordText,
        userPermissions: ["print", "modify", "copy", "annot-forms"]
      };
    }

    const opt = {
      margin:       10, // margins in mm
      filename:     `${activeFileName}.pdf`,
      image:        { type: 'jpeg', quality: qualityVal },
      html2canvas:  { scale: scaleVal, useCORS: true, letterRendering: true },
      jsPDF:        jsPdfOpts
    };

    try {
      // Run local PDF compiler with constructor-level encryption
      await html2pdf().set(opt).from(printContainer).save();
      
      addLog(`성공: PDF 다운로드가 완료되었습니다. (${activeFileName}.pdf)`, 'success');
      updateProgress('완료', 100);
      alert('PDF 변환이 완료되었습니다! 다운로드 폴더를 확인해 주세요.');
    } catch (error) {
      console.error(error);
      addLog(`오류: PDF 생성 실패 - ${error.message}`, 'error');
      updateProgress('출력 오류', 0);
      alert('PDF 출력 중 오류가 발생했습니다.');
    } finally {
      // Safely cleanup temporary printing DOM elements
      document.body.removeChild(printContainer);
      btnDownload.disabled = false;
    }
  });

  // 10. Copy plain text to clipboard
  btnCopyText.addEventListener('click', async () => {
    if (!activeParsedHtml) return;
    try {
      // Extract clean plain text from the rendered document view
      const plainText = renderOutput.innerText;
      await navigator.clipboard.writeText(plainText);
      addLog('성공: 본문 텍스트 전체가 클립보드에 복사되었습니다.', 'success');
      alert('본문 텍스트가 클립보드에 성공적으로 복사되었습니다!');
    } catch (err) {
      addLog(`오류: 텍스트 복사 실패 - ${err.message}`, 'error');
      alert('텍스트 복사 도중 오류가 발생했습니다.');
    }
  });

  // 11. PDF direct browser printing compilation engine
  btnPrint.addEventListener('click', async () => {
    if (!activeParsedHtml) return;

    btnPrint.disabled = true;
    updateProgress('인쇄 준비 중...', 80);
    addLog('PDF 레이아웃 조율 및 브라우저 인쇄 모드 호출 중...', 'working');

    // Create temporary printing DOM container
    const printContainer = document.createElement('div');
    printContainer.className = 'hwpx-rendered-content';
    printContainer.style.background = '#ffffff';
    printContainer.style.color = '#1e293b';
    printContainer.style.width = '800px';
    printContainer.style.padding = '50px 60px';
    printContainer.style.fontFamily = 'Inter, "Noto Sans KR", sans-serif';
    printContainer.style.position = 'relative';
    printContainer.style.minHeight = '1000px';
    printContainer.innerHTML = activeParsedHtml;
    
    // Inject watermark overlay if specified
    const watermarkText = watermarkInput ? watermarkInput.value.trim() : '';
    if (watermarkText) {
      const wOverlay = document.createElement('div');
      wOverlay.className = 'watermark-overlay';
      wOverlay.textContent = watermarkText;
      printContainer.appendChild(wOverlay);
    }
    
    // Inject static frozen timestamp footer in printed document
    const printTimestamp = document.createElement('div');
    printTimestamp.className = 'timestamp-watermark';
    printTimestamp.textContent = formatDateTime(new Date());
    printContainer.appendChild(printTimestamp);
    
    document.body.appendChild(printContainer);

    const resolutionSelect = document.getElementById('resolutionSelect');
    const qualityMode = resolutionSelect ? resolutionSelect.value : 'medium';
    
    let scaleVal = 2.0;
    let qualityVal = 0.8;
    
    if (qualityMode === 'high') {
      scaleVal = 2.8;
      qualityVal = 0.98;
    } else if (qualityMode === 'low') {
      scaleVal = 1.3;
      qualityVal = 0.55;
    }

    const passwordText = passwordInput ? passwordInput.value : '';

    const jsPdfOpts = { unit: 'mm', format: 'a4', orientation: 'portrait' };
    if (passwordText) {
      jsPdfOpts.encryption = {
        userPassword: passwordText,
        ownerPassword: passwordText,
        userPermissions: ["print", "modify", "copy", "annot-forms"]
      };
    }

    const opt = {
      margin:       10,
      filename:     `${activeFileName}.pdf`,
      image:        { type: 'jpeg', quality: qualityVal },
      html2canvas:  { scale: scaleVal, useCORS: true, letterRendering: true },
      jsPDF:        jsPdfOpts
    };

    try {
      const worker = html2pdf().set(opt).from(printContainer);
      
      // Open native printing dialogue automatically with constructor-level encryption
      await worker.toPdf().get('pdf').then(function(pdf) {
        pdf.autoPrint();
        window.open(pdf.output('bloburl'), '_blank');
      });
      
      addLog('성공: 브라우저 직접 인쇄 창이 무사히 활성화되었습니다.', 'success');
      updateProgress('완료', 100);
    } catch (error) {
      console.error(error);
      addLog(`오류: 인쇄 생성 실패 - ${error.message}`, 'error');
      updateProgress('인쇄 오류', 0);
      alert('인쇄 문서 생성 도중 오류가 발생했습니다.');
    } finally {
      document.body.removeChild(printContainer);
      btnPrint.disabled = false;
    }
  });

  // 12. Real-time watermark input change event
  watermarkInput.addEventListener('input', () => {
    updateWatermarkPreview(watermarkInput.value);
  });

  function updateWatermarkPreview(text) {
    // Purge existing overlays
    const existing = documentPage.querySelectorAll('.watermark-overlay');
    existing.forEach(el => el.remove());
    
    if (!text.trim()) return;
    
    // Inject preview overlay
    const overlay = document.createElement('div');
    overlay.className = 'watermark-overlay';
    overlay.textContent = text.trim();
    documentPage.appendChild(overlay);
  }

  // 13. Dynamic Live Ticking Clock Footer Timestamp
  function formatDateTime(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const sec = pad(date.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
  }

  const pageTimestamp = document.getElementById('pageTimestamp');
  if (pageTimestamp) {
    pageTimestamp.textContent = formatDateTime(new Date());
  }

  // Update ticking clock footer timestamp every second
  setInterval(() => {
    const now = new Date();
    const formatted = formatDateTime(now);
    const tsElements = document.querySelectorAll('.timestamp-watermark');
    tsElements.forEach(el => el.textContent = formatted);
  }, 1000);
});
