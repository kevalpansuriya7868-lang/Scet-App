import { api } from '../api.js';
import { h, fields, modal, toast, table, badge, resizeImage } from '../ui.js';
import { specsModal } from './ledger.js';

/** Full-screen lightbox — click anywhere to close */
function lightbox(src, alt) {
  const ov = h('div', {
    style: 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out',
    onclick: () => ov.remove(),
  },
    h('img', { src, alt, style: 'max-width:95vw;max-height:92vh;object-fit:contain;border-radius:6px;box-shadow:0 0 60px rgba(0,0,0,0.8)' }),
    h('button', {
      style: 'position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:2rem;cursor:pointer;line-height:1',
      onclick: () => ov.remove(),
    }, '×'),
  );
  document.body.append(ov);
}

/** Make an img element that opens the lightbox on click */
function lbImg(src, alt, style = '') {
  return h('img', {
    src, alt,
    style: `${style};cursor:zoom-in;transition:transform .15s;border-radius:8px;object-fit:contain;border:1px solid var(--line)`,
    onclick: () => lightbox(src, alt),
    onmouseenter: (e) => { e.target.style.transform = 'scale(1.04)'; },
    onmouseleave: (e) => { e.target.style.transform = ''; },
  });
}

/** Open full image in a clean new browser tab */
function openInNewTab(src, title = 'Component Image') {
  const w = window.open('');
  if (w) {
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      background: #12151b;
      color: #e0e0e0;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      box-sizing: border-box;
    }
    h2 { margin: 0 0 14px; font-size: 1.15rem; color: #f0f0f0; font-weight: 600; }
    img {
      max-width: 95vw;
      max-height: 86vh;
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      background: #1c202a;
    }
  </style>
</head>
<body>
  <h2>${title}</h2>
  <img src="${src}" alt="${title}" />
</body>
</html>`);
    w.document.close();
  } else {
    lightbox(src, title);
  }
}

/** Open an image gallery modal for a component (admin side) with Add New, Open in New Tab, and Delete options */
function imagesModal(compName, compId, branchCode, onUpdated) {
  let currentImgs = [];
  const g = h('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;min-height:100px;align-items:center;margin-top:14px' });
  const status = h('div', { style: 'font-size:0.88em;color:var(--muted);line-height:1.4' }, 'Loading images…');

  const addInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, style: 'display:none',
    onchange: async (e) => {
      if (!e.target.files.length) return;
      try {
        const remainingSlots = 5 - currentImgs.length;
        if (remainingSlots <= 0) {
          toast('Maximum 5 images allowed per component. Please delete an image first.', 'warn');
          return;
        }
        status.textContent = '⏳ Processing and adding new images…';
        const newFiles = [...e.target.files].slice(0, remainingSlots);
        const resized = await Promise.all(newFiles.map(x => resizeImage(x)));
        // Append without replacing old images
        currentImgs = [...currentImgs, ...resized];
        await api(`/api/branches/${branchCode}/components/${compId}/images`, {
          method: 'PUT',
          body: { images: currentImgs }
        });
        toast(`Added ${resized.length} image(s). (${currentImgs.length}/5 total)`);
        renderGallery();
        if (onUpdated) onUpdated();
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        addInput.value = '';
      }
    }
  });

  const addBtn = h('button', {
    type: 'button',
    class: 'btn sm gold',
    style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:130px;height:140px;border:2px dashed #e0a800;border-radius:10px;background:rgba(255,193,7,0.08);cursor:pointer;transition:all .15s',
    onclick: () => {
      if (currentImgs.length >= 5) {
        toast('Maximum 5 images reached. Delete an existing image first to add new ones.', 'warn');
        return;
      }
      addInput.click();
    }
  },
    h('span', { style: 'font-size:1.8em' }, '➕'),
    h('span', { style: 'font-size:0.85em;font-weight:700;color:var(--ink)' }, 'Add new image'),
    h('span', { style: 'font-size:0.7em;color:var(--muted)' }, `(${5 - currentImgs.length} slots left)`)
  );

  function renderGallery() {
    status.innerHTML = `<b>${currentImgs.length} / 5 image(s)</b> — Old images are kept! Click <b>↗ Tab</b> to open in a new tab, or <b>✕</b> to delete. Click <b>➕ Add new image</b> to upload more.`;
    const cards = currentImgs.map((src, idx) => {
      return h('div', {
        style: 'position:relative;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;border:1.5px solid var(--line,#e0e0e0);background:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.08);width:130px'
      },
        h('div', {
          style: 'position:relative;width:130px;height:105px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:zoom-in',
          onclick: () => lightbox(src, `${compName} (${idx + 1})`)
        },
          h('img', { src, alt: `${compName} (${idx + 1})`, style: 'width:100%;height:100%;object-fit:cover;display:block' }),
          // Delete button (✕)
          h('button', {
            type: 'button',
            title: 'Delete this image',
            style: 'position:absolute;top:5px;right:5px;background:#d93025;color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;line-height:1;box-shadow:0 2px 5px rgba(0,0,0,0.3)',
            onclick: async (e) => {
              e.stopPropagation();
              if (!confirm(`Delete image ${idx + 1}?`)) return;
              try {
                currentImgs.splice(idx, 1);
                await api(`/api/branches/${branchCode}/components/${compId}/images`, {
                  method: 'PUT',
                  body: { images: currentImgs }
                });
                toast('Image deleted.');
                renderGallery();
                if (onUpdated) onUpdated();
              } catch (err) {
                toast(err.message, 'err');
              }
            }
          }, '✕')
        ),
        // Action toolbar below image: Open in new tab button
        h('div', { style: 'padding:5px 6px;background:#fafafa;border-top:1px solid var(--line,#eee);display:flex;align-items:center;justify-content:space-between' },
          h('span', { style: 'font-size:0.75em;color:var(--muted);font-weight:600' }, `Image ${idx + 1}`),
          h('button', {
            type: 'button',
            title: 'Open this image in a new tab',
            style: 'border:1px solid #d0d7de;background:#fff;border-radius:4px;padding:2px 6px;font-size:0.72em;cursor:pointer;font-weight:600;color:#0969da;display:flex;align-items:center;gap:3px',
            onclick: (e) => {
              e.stopPropagation();
              openInNewTab(src, `${compName} - Image ${idx + 1}`);
            }
          }, '↗ Tab')
        )
      );
    });

    g.replaceChildren(...cards, currentImgs.length < 5 ? addBtn : null);
  }

  api(`/api/catalog/${branchCode}/components/${compId}/images`).then(imgs => {
    currentImgs = imgs || [];
    renderGallery();
  }).catch(() => {
    status.textContent = 'Failed to load images.';
  });

  modal(`${compName} — Manage Images`, h('div', { class: 'stack' }, status, g, addInput), [{ label: 'Close', run: (c) => c() }]);
}

/**
 * Fetch 2-3 distinct real photos from a Wikipedia page.
 * Uses the generator=images API to list all images, filters out
 * SVG/PNG icons and tiny thumbnails, then resolves actual URLs.
 */
async function fetchWikiImages(title) {
  // Step 1: get list of image file names on the page
  const listRes = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&generator=images&gimlimit=50` +
    `&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=700` +
    `&titles=${encodeURIComponent(title)}&format=json&origin=*`
  );
  const listJson = await listRes.json();
  const pages = Object.values(listJson.query?.pages || {});

  // Step 2: filter to real product photos
  const qWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const candidates = pages
    .map(p => ({ fname: (p.title || '').toLowerCase(), info: p.imageinfo?.[0] }))
    .filter(({ fname, info }) => {
      if (!info) return false;
      if (!info.url) return false;
      const ext = info.url.split('.').pop().toLowerCase().split('?')[0];
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return false;
      if ((info.width || 0) < 150 || (info.height || 0) < 100) return false;
      if (/logo|icon|flag|seal|coat.of.arm|signature|symbol|diagram|chart|graph|map|schematic|pinout|wiring/i.test(fname)) return false;
      return true;
    })
    .sort((a, b) => {
      // Prioritize images that contain parts of the component name (e.g. uno, arduino)
      const aMatches = qWords.filter(w => a.fname.includes(w)).length;
      const bMatches = qWords.filter(w => b.fname.includes(w)).length;
      if (bMatches !== aMatches) return bMatches - aMatches;
      return (b.info.width * b.info.height) - (a.info.width * a.info.height);
    })
    .map(({ info }) => info);

  // Step 3: pick up to 3 distinct photos
  const dataUrls = [];
  const seenSizes = new Set();
  for (const ii of candidates) {
    if (dataUrls.length >= 3) break;
    try {
      const imgFetchUrl = ii.thumburl || ii.url;
      const r = await fetch(imgFetchUrl);
      if (!r.ok) continue;
      const blob = await r.blob();
      if (seenSizes.has(blob.size)) continue;
      seenSizes.add(blob.size);
      const dataUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      dataUrls.push(dataUrl);
    } catch { /* skip unreachable images */ }
  }
  return dataUrls;
}

// ── Smart category guesser for ECE & Computer Engineering hardware ────────────
const CATEGORY_MAP = [
  // 1. Boards (Arduino Uno/Nano/Mega, Raspberry Pi, ESP dev boards, STM32 Nucleo, breakout boards)
  [/arduino|raspberry pi|uno\b|nano\b|mega\b|nucleo|esp32.*board|esp8266.*board|development board|microcontroller board|single.board|\bboard\b|breakout board|shield\b|launchpad/i, 'Board'],

  // 2. Logic Gates & Digital ICs (74xx, 40xx, AND/OR/NAND/NOR/XOR, flip-flops, mux, decoder)
  [/logic gate|gate\b|74[a-z]?\d{2,3}|40\d{2}|flip.?flop|multiplexer|\bmux\b|demux|decoder|encoder|shift register|counter|alu\b|combinational|sequential|digital ic/i, 'Logic Gate / Digital IC'],

  // 3. Microcontrollers & Processors (chips/MCUs)
  [/microcontroller|microprocessor|\bmcu\b|atmega|attiny|pic\d|stm32|8051|8086|8085|arm cortex|avr\b|soc\b|integrated circuit chip/i, 'Microcontroller'],

  // 4. Computer Hardware & Architecture (RAM, ROM, Storage, CPU, GPU, Network)
  [/ram\b|sram|dram|eeprom|flash memory|rom\b|hard drive|ssd\b|motherboard|cpu\b|gpu\b|bus interface|pci|ethernet|network card|computer hardware/i, 'Computer Hardware'],

  // 5. Sensors
  [/sensor|transducer|dht\d|bmp\d|bme\d|mpu\d|ldr\b|pir\b|ultrasonic|sonar|infrared|ir sensor|accelerometer|gyroscope|thermocouple|load cell|hall effect|gas sensor|mq-\d/i, 'Sensor'],

  // 6. Wireless & Communication (ECE)
  [/wireless|rf\b|bluetooth|ble\b|wi.?fi|lora|zigbee|gsm|gprs|gps\b|antenna|transceiver|modem|uart|i2c|spi|can bus|rs.?232|rs.?485|nrf24/i, 'Communication Module'],

  // 7. Motors, Drivers & Actuators
  [/motor|servo|stepper|actuator|solenoid|l298|l293|a4988|drv8825|motor driver|h-bridge/i, 'Motor & Driver'],

  // 8. Switches & Relays
  [/relay|switch|contactor|reed switch|push button|toggle switch/i, 'Relay & Switch'],

  // 9. Displays
  [/display|lcd|oled|tft|7.?segment|seven.segment|led matrix|e.?paper|monitor|screen/i, 'Display'],

  // 10. Discrete / Semiconductor Components
  [/transistor|mosfet|bjt|fet\b|diode|zener|led\b|rectifier|thyristor|triac|scr\b|op.?amp|operational amplifier|comparator|555 timer|timer ic/i, 'Semiconductor / IC'],

  // 11. Passive Components
  [/resistor|potentiometer|capacitor|inductor|choke|transformer|crystal|oscillator|fuse/i, 'Passive Component'],

  // 12. Power & Regulators
  [/power supply|voltage regulator|regulator|lm78\d{2}|lm317|buck|boost|step.?down|step.?up|converter|battery|charger|bms\b|power bank/i, 'Power Supply'],

  // 13. Prototyping & Lab Equipment
  [/breadboard|veroboard|pcb|jumper wire|header pins|soldering|multimeter|oscilloscope|function generator|logic analyzer|probe/i, 'Prototyping & Tools'],
];

function guessCategory(title, extract, desc = '') {
  const text = `${title} ${desc} ${extract}`;
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(text)) return cat;
  }
  return 'Electronics';
}

// ── Wikipedia REST summary (much more reliable than raw API) ─────────────────
async function fetchWikiSummary(title) {
  // REST API returns clean JSON with extract, thumbnail, etc.
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Wikipedia: ${res.status}`);
  return res.json();
}

// ── Specific Board Revisions & Variants ─────────────────────────────────────
const KNOWN_VARIANTS = {
  'arduino uno': {
    familyName: 'Arduino Uno',
    variants: [
      {
        name: 'Arduino Uno R3',
        tag: 'Uno R3 (Classic)',
        desc: 'ATmega328P DIP · 16MHz · 5V · Classic Revision 3',
        category: 'Board',
        specifications: 'Microcontroller: ATmega328P (8-bit AVR)\nOperating Voltage: 5V | Input Voltage (recommended): 7-12V\nClock Speed: 16 MHz\nMemory: 32 KB Flash, 2 KB SRAM, 1 KB EEPROM\nDigital I/O: 14 pins (6 PWM outputs)\nAnalog Inputs: 6 channels (10-bit ADC)\nDC Current per I/O Pin: 20 mA\nUSB Interface: Type-B (ATmega16U2 USB controller)',
        imageFiles: ['File:Arduino Uno - R3.jpg', 'File:Arduino Uno 006.jpg'],
        thumb: 'https://upload.wikimedia.org/wikipedia/commons/3/38/Arduino_Uno_-_R3.jpg'
      },
      {
        name: 'Arduino Uno R4 WiFi',
        tag: 'Uno R4 WiFi',
        desc: '32-bit Renesas RA4M1 (48MHz) + ESP32-S3 WiFi/BLE + 12x8 LED Matrix',
        category: 'Board',
        specifications: 'Microcontroller: Renesas RA4M1 (Arm 32-bit Cortex-M4 @ 48 MHz)\nWireless Coprocessor: ESP32-S3-MINI-1-N8 (Wi-Fi 802.11 b/g/n + Bluetooth 5.0 LE)\nOn-board Display: 12x8 red LED Matrix (96 addressable LEDs)\nOperating Voltage: 5V | Input Voltage: 6-24V\nMemory: 256 KB Flash, 32 KB SRAM, 8 KB DataFlash\nDigital I/O: 14 (6 PWM) | Analog: 6 (14-bit ADC) | 1x 12-bit DAC\nInterfaces: CAN bus, I2C (Qwiic connector), SPI, UART\nUSB: USB-C (supports HID)',
        imageFiles: ['File:Arduino Uno R4 WiFi.webp', 'File:Arduino Uno 006.jpg'],
        thumb: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/90/Arduino_Uno_R4_WiFi.webp/960px-Arduino_Uno_R4_WiFi.webp'
      },
      {
        name: 'Arduino Uno R4 Minima',
        tag: 'Uno R4 Minima',
        desc: '32-bit Renesas RA4M1 (48MHz) · USB-C · High-speed 12-bit DAC',
        category: 'Board',
        specifications: 'Microcontroller: Renesas RA4M1 (Arm 32-bit Cortex-M4 @ 48 MHz)\nOperating Voltage: 5V | Input Voltage: 6-24V\nMemory: 256 KB Flash, 32 KB SRAM, 8 KB DataFlash\nDigital I/O: 14 (6 PWM) | Analog: 6 (14-bit ADC) | 1x 12-bit DAC\nInterfaces: CAN bus, I2C, SPI, UART\nUSB Connector: USB-C (HID keyboard/mouse emulation)',
        imageFiles: ['File:Arduino Uno 006.jpg', 'File:Arduino Uno - R3.jpg'],
        thumb: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/Arduino_Uno_006.jpg/960px-Arduino_Uno_006.jpg'
      },
      {
        name: 'Arduino Uno SMD',
        tag: 'Uno SMD',
        desc: 'Surface-mount ATmega328P TQFP edition with extra ADC pins',
        category: 'Board',
        specifications: 'Microcontroller: ATmega328P (32-pin TQFP surface mount package)\nOperating Voltage: 5V | Input Voltage: 7-12V\nClock Speed: 16 MHz\nMemory: 32 KB Flash, 2 KB SRAM, 1 KB EEPROM\nDigital I/O: 14 pins (6 PWM)\nAnalog Inputs: 6 (plus exposed solder pads for A6/A7)\nUSB Interface: Type-B',
        imageFiles: ['File:Arduino Uno - R3.jpg', 'File:Arduino Uno 006.jpg'],
        thumb: 'https://upload.wikimedia.org/wikipedia/commons/3/38/Arduino_Uno_-_R3.jpg'
      },
      {
        name: 'Arduino Uno WiFi Rev 2',
        tag: 'Uno WiFi Rev 2',
        desc: 'ATmega4809 (20MHz) + u-blox WiFi/BLE + Crypto & 6-axis IMU',
        category: 'Board',
        specifications: 'Microcontroller: Microchip ATmega4809 (8-bit AVR @ 20 MHz)\nWireless: u-blox NINA-W102 (WiFi 802.11 b/g/n + BLE 4.2)\nSensors: LSM6DS3TR 6-axis IMU (gyroscope & accelerometer)\nSecurity: ATECC608A Cryptographic Co-processor\nMemory: 48 KB Flash, 6 KB SRAM, 256 Bytes EEPROM\nDigital I/O: 14 (5 PWM), 6 Analog Inputs (10-bit)\nOperating Voltage: 5V',
        imageFiles: ['File:Arduino Uno - R3.jpg'],
        thumb: 'https://upload.wikimedia.org/wikipedia/commons/3/38/Arduino_Uno_-_R3.jpg'
      }
    ]
  },
  'arduino nano': {
    familyName: 'Arduino Nano',
    variants: [
      {
        name: 'Arduino Nano V3.0',
        tag: 'Nano V3.0',
        desc: 'ATmega328P 16MHz · Mini-USB · Classic breadboard form-factor',
        category: 'Board',
        specifications: 'Microcontroller: ATmega328P (8-bit AVR)\nClock Speed: 16 MHz | Operating Voltage: 5V\nMemory: 32 KB Flash, 2 KB SRAM, 1 KB EEPROM\nDigital I/O: 14 (6 PWM) | Analog: 8 (10-bit ADC)\nBreadboard Friendly Pinout | USB: Mini-B'
      },
      {
        name: 'Arduino Nano Every',
        tag: 'Nano Every',
        desc: 'ATmega4809 20MHz · 48KB Flash · 5V tolerant replacement',
        category: 'Board',
        specifications: 'Microcontroller: ATmega4809 (8-bit AVR @ 20 MHz)\nOperating Voltage: 5V\nMemory: 48 KB Flash, 6 KB SRAM, 256B EEPROM\nDigital I/O: 14 (5 PWM) | Analog: 8\nUSB: Micro-USB'
      },
      {
        name: 'Arduino Nano 33 BLE',
        tag: 'Nano 33 BLE',
        desc: 'Nordic nRF52840 (64MHz ARM Cortex-M4F) + Bluetooth 5.0 + 9-axis IMU',
        category: 'Board',
        specifications: 'Microcontroller: Nordic nRF52840 (32-bit ARM Cortex-M4F @ 64MHz)\nWireless: Bluetooth 5.0 LE | Operating Voltage: 3.3V\nSensors: LSM9DS1 9-axis IMU\nMemory: 1 MB Flash, 256 KB SRAM\nDigital I/O: 14 | Analog: 8'
      },
      {
        name: 'Arduino Nano ESP32',
        tag: 'Nano ESP32',
        desc: 'ESP32-S3 Dual-core 240MHz + Wi-Fi & BLE + USB-C',
        category: 'Board',
        specifications: 'Microcontroller: u-blox NORA-W106 (ESP32-S3, dual-core Xtensa LX7 @ 240MHz)\nWireless: Wi-Fi 802.11 b/g/n + Bluetooth 5.0 LE\nMemory: 8 MB Flash, 512 KB SRAM\nUSB: USB-C | Operating Voltage: 3.3V'
      }
    ]
  },
  'arduino mega': {
    familyName: 'Arduino Mega',
    variants: [
      {
        name: 'Arduino Mega 2560 R3',
        tag: 'Mega 2560 R3',
        desc: 'ATmega2560 16MHz · 54 Digital I/O · 16 Analog Inputs · 4 UARTs',
        category: 'Board',
        specifications: 'Microcontroller: Microchip ATmega2560 (8-bit AVR @ 16 MHz)\nOperating Voltage: 5V | Input: 7-12V\nMemory: 256 KB Flash (8KB for bootloader), 8 KB SRAM, 4 KB EEPROM\nDigital I/O: 54 pins (15 PWM)\nAnalog Inputs: 16 (10-bit ADC)\nHardware Serial Ports (UART): 4 ports\nUSB Interface: Type-B'
      }
    ]
  },
  'esp32': {
    familyName: 'ESP32',
    variants: [
      {
        name: 'ESP32 DevKit V1 (ESP-WROOM-32)',
        tag: 'DevKit V1',
        desc: 'Xtensa Dual-Core 240MHz + Wi-Fi 802.11 b/g/n + Bluetooth v4.2 BR/EDR/BLE',
        category: 'Board',
        specifications: 'Module: ESP-WROOM-32 (Xtensa 32-bit LX6 dual-core @ 240 MHz)\nWireless: Wi-Fi 802.11 b/g/n + Bluetooth 4.2 BLE\nOperating Voltage: 3.3V (5V via Micro-USB)\nMemory: 4 MB SPI Flash, 520 KB SRAM\nGPIO: 30 pins, 12-bit ADC, capacitive touch sensors, DAC, PWM, I2C, SPI, UART'
      },
      {
        name: 'ESP32-CAM',
        tag: 'ESP32-CAM',
        desc: 'Dual-core ESP32 + OV2640 2MP Camera + MicroSD Card Slot',
        category: 'Board',
        specifications: 'Microcontroller: ESP32-S dual-core 32-bit CPU\nCamera: OV2640 2 Megapixel sensor included\nStorage: MicroSD card slot on-board (supports up to 4GB)\nMemory: 520 KB SRAM + 4 MB PSRAM\nWireless: 802.11 b/g/n Wi-Fi + Bluetooth 4.2 BLE\nOn-board bright flash LED'
      },
      {
        name: 'ESP32-S3 DevKit',
        tag: 'ESP32-S3',
        desc: 'Dual-core Xtensa LX7 @ 240MHz + Vector Instructions for AI/ML + USB OTG',
        category: 'Board',
        specifications: 'Processor: Xtensa 32-bit LX7 dual-core up to 240 MHz with AI vector instructions\nWireless: 2.4 GHz Wi-Fi (802.11 b/g/n) + Bluetooth 5.0 LE\nMemory: 8 MB Flash, 512 KB SRAM, 2 MB PSRAM\nDual Type-C USB ports (USB-to-UART + native USB OTG)'
      }
    ]
  },
  'raspberry pi': {
    familyName: 'Raspberry Pi',
    variants: [
      {
        name: 'Raspberry Pi 5',
        tag: 'Pi 5',
        desc: 'Broadcom BCM2712 Quad-core Cortex-A76 @ 2.4GHz · PCIe 2.0 · Dual 4K HDMI',
        category: 'Board',
        specifications: 'Processor: Broadcom BCM2712 64-bit quad-core Arm Cortex-A76 @ 2.4GHz\nRAM: 4GB or 8GB LPDDR4X-4267\nVideo: Dual 4Kp60 micro-HDMI outputs with HDR\nConnectivity: Gigabit Ethernet with PoE+ support, Dual-band Wi-Fi, Bluetooth 5.0 BLE\nExpansion: PCIe 2.0 x1 interface, 40-pin GPIO header, 2x 4-lane MIPI camera/display'
      },
      {
        name: 'Raspberry Pi 4 Model B',
        tag: 'Pi 4B',
        desc: 'Broadcom BCM2711 Quad-core Cortex-A72 @ 1.8GHz · Dual 4K Micro-HDMI',
        category: 'Board',
        specifications: 'Processor: Broadcom BCM2711 quad-core Cortex-A72 (ARM v8) 64-bit SoC @ 1.8GHz\nRAM: 2GB, 4GB, or 8GB LPDDR4\nConnectivity: Gigabit Ethernet, 2.4/5.0 GHz Wi-Fi, Bluetooth 5.0 BLE\nPorts: 2x USB 3.0, 2x USB 2.0, 2x micro-HDMI (4K60), USB-C power (5V 3A)'
      },
      {
        name: 'Raspberry Pi Pico W',
        tag: 'Pico W',
        desc: 'RP2040 Dual-core Cortex-M0+ @ 133MHz + Infineon CYW43439 Wi-Fi/BLE',
        category: 'Board',
        specifications: 'Microcontroller: RP2040 designed by Raspberry Pi (Dual ARM Cortex-M0+ @ 133MHz)\nWireless: Infineon CYW43439 2.4GHz Wi-Fi (802.11n) + Bluetooth 5.2\nMemory: 2 MB on-board QSPI Flash, 264 KB multi-bank SRAM\nGPIO: 26 multi-function pins, 3 analog inputs (12-bit ADC), 2x SPI, 2x I2C, 2x UART, 8x PIO'
      }
    ]
  }
};

/** Fetch Wikimedia images by exact File: titles */
async function fetchImagesByFilenames(filenames) {
  try {
    const titles = filenames.map(f => f.startsWith('File:') ? f : 'File:' + f).join('|');
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=700&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});
    const urls = pages.map(p => p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url).filter(Boolean);

    const dataUrls = [];
    const seenSizes = new Set();
    for (const u of urls) {
      if (dataUrls.length >= 3) break;
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const blob = await r.blob();
        if (seenSizes.has(blob.size)) continue;
        seenSizes.add(blob.size);
        const dataUrl = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        dataUrls.push(dataUrl);
      } catch {}
    }
    return dataUrls;
  } catch {
    return [];
  }
}

// ── Autocomplete scoped to technical devices, components, boards & revisions ──
const EXCLUDE_RE = /\b(song|songs|album|albums|musical\s+single|lead\s+single|promo\s+single|soundtrack|discography|mixtape|record\s+label|band|musician|singers?|vocalist|artist|food|dish|dishes|cuisine|recipe|recipes|fruit|fruits|vegetable|vegetables|beverage|beverages|snack|dessert|pastry|pie|company|companies|corporation|corporations|business|businesses|conglomerate|subsidiary|foundation|foundations|charity|charities|non-profit|ngo|fundraising|person|people|actor|actress|actresses|geologist|botanist|painter|architect|politician|politicians|writer|writers|poet|poets|director|directors|athlete|athletes|footballer|footballers|cricketer|cricketers|player|players|biography|surname|given\s+name|name\s+list|cardinal|bishop|monarch|king|queen|prince|president|presidents|minister|ministers|general\b|soldier|soldiers|military|journalist|journalists|physician|physicians|historian|historians|scholar|professors?|fellow\b|film|films|movie|movies|television|tv\s+series|video\s+game|novel|novels|comic|comics|painting|paintings|sport|sports|race|races|racing|tournament|championship|former\s+town|town|city|village|county|district|commune|building|apartment|avenue|street|decade|century|squadron|unit\b|natural\s+number|species|mammal|mammals|animal|animals|fungus|plant|insect|ant\b|disease|chemical\s+compound|reserve|atoll|island|lake|mountain|river|radio\s+station|radio\s+frequency)\b|\(\d{4}[–-]/i;

const STRICT_EXCLUDE_RE = /\b(person|actor|actress|geologist|botanist|painter|architect|politician|singer|musician|writer|poet|director|historian|biography|company|corporation|conglomerate|foundation|charity|album|song|film|sport|mammal|animal|species|plant|fungus|disease|building|decade)\b/i;

const HARDWARE_PROTECT_RE = /\b(board|single-board|microcontroller|microprocessor|processor|integrated\s+circuit|semiconductor|chip|sensor|logic\s+gate|gate|transistor|diode|led|resistor|capacitor|inductor|relay|motor|servo|stepper|display|lcd|oled|breadboard|pcb|hardware|computer|module|shield|breakout|electronic|device|circuit|switch|oscillator|converter|regulator|amplifier|transceiver|bus|pinout|header)\b/i;

async function wikiSuggest(q) {
  const ql = q.toLowerCase().trim();
  const matchedVariants = [];

  // 1. Check known board variants first (e.g. Arduino Uno R3, R4 WiFi, Nano, ESP32, Raspberry Pi)
  for (const [key, fam] of Object.entries(KNOWN_VARIANTS)) {
    if (key.includes(ql) || ql.includes(key) || (ql.startsWith('uno') && key === 'arduino uno')) {
      for (const v of fam.variants) {
        matchedVariants.push({
          title: v.name,
          desc: v.desc || '',
          thumb: v.thumb || '',
          isBoard: true,
          badge: v.tag || 'Board',
          variant: v
        });
      }
    }
  }

  // 2. Query Wikipedia prefixsearch
  const url = `https://en.wikipedia.org/w/api.php?action=query&generator=prefixsearch&gpssearch=${encodeURIComponent(q)}&gpslimit=12&prop=description|extracts|pageimages&exintro=1&explaintext=1&exchars=160&piprop=thumbnail&pithumbsize=90&format=json&origin=*`;
  let wikiItems = [];
  try {
    const res = await fetch(url);
    const data = await res.json();
    const pages = Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index);

    const filtered = pages.filter(p => {
      const desc = p.description || '';
      const extract = p.extract || '';
      const title = p.title || '';
      const fullText = (title + ' ' + desc + ' ' + extract).toLowerCase();

      if (STRICT_EXCLUDE_RE.test(desc) || /\bwas an?\b|\(born\b|\(\d{4}[–-]/i.test(extract)) return false;
      if (/\((film|album|song|band|company|soundtrack|musician|disambiguation)\)/i.test(title)) return false;
      if (EXCLUDE_RE.test(desc)) return false;

      if (EXCLUDE_RE.test(fullText)) {
        if (HARDWARE_PROTECT_RE.test(desc) || HARDWARE_PROTECT_RE.test(extract)) return true;
        return false;
      }
      return true;
    });

    wikiItems = filtered.map(p => ({
      title: p.title,
      desc: p.description || '',
      thumb: p.thumbnail?.source || '',
      isBoard: /board|single.board|arduino|raspberry\s*pi|uno\b|nano\b|mega\b|esp32.*board|nucleo/i.test((p.title || '') + ' ' + (p.description || '')),
      isSensor: /sensor|transducer|dht|bmp|mpu/i.test((p.title || '') + ' ' + (p.description || '')),
      isLogicGate: /logic gate|gate\b|74[a-z]?\d{2,3}|nand|nor|xor/i.test((p.title || '') + ' ' + (p.description || '')),
      variant: null
    }));
  } catch {}

  // Deduplicate
  const variantTitles = new Set(matchedVariants.map(v => v.title.toLowerCase()));
  const combined = [
    ...matchedVariants,
    ...wikiItems.filter(w => !variantTitles.has(w.title.toLowerCase()))
  ];

  return combined.slice(0, 10);
}

export async function inventoryTab(code) {
  const base = `/api/branches/${code}/components`;
  const q = h('input', { placeholder: 'Search by code, name or category…' });
  const stats = h('div', { class: 'stats' }), tbody = h('tbody');

  const load = async () => {
    const [s, rows] = await Promise.all([api(`/api/catalog/${code}/stats`), api(`/api/catalog/${code}/components?q=${encodeURIComponent(q.value)}`)]);
    stats.replaceChildren(...[['Item types', s.totalItems], ['Total units', s.totalQty], ['Issued', s.totalIssued], ['Overdue', s.totalOverdue]].map(([l, v]) => h('div', { class: 'stat' }, h('b', {}, v), l)));
    tbody.replaceChildren(...rows.map((c) => h('tr', {},
      h('td', {}, c.compId), h('td', {}, c.name), h('td', {}, c.category),
      // Specs — show "View" button instead of raw text
      h('td', {}, c.specifications
        ? h('button', { class: 'btn ghost sm', onclick: () => specsModal(c.name, c.specifications) }, '📋 View specs')
        : h('span', { class: 'muted' }, '—')),
      h('td', {}, c.totalQty), h('td', {}, c.issuedQty),
      // Images — click to open Manage Images modal (add new, view old, delete)
      h('td', {}, h('button', {
        class: 'btn ghost sm',
        onclick: () => imagesModal(c.name, c.compId, code, load)
      }, c.imageCount > 0 ? `🖼 View ${c.imageCount}` : '📷 + Add images')),
      h('td', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => edit(c) }, 'Edit'),
        h('button', { class: 'btn danger sm', onclick: () => remove(c) }, 'Delete')))));
  };

  function edit(c) {
    const f = fields([
      { name: 'name', label: 'Component name', value: c?.name }, { name: 'category', label: 'Category', value: c?.category },
      { name: 'specifications', label: 'Specifications', value: c?.specifications }, { name: 'totalQty', label: 'Total quantity', type: 'number', min: 1, value: c?.totalQty },
    ]);

    // ── Smart Web Auto-fill & Image Gallery ──────────────────────────────────
    let imgs = [];
    const thumbs = h('div', { class: 'thumbs', style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;min-height:20px' });
    const imageCountLabel = h('span', { style: 'font-weight:600' }, 'Images (0 / 5) — Add new images, or click ✕ to delete:');
    const statusLine = h('span', { style: 'font-size:0.8em;color:var(--muted,#888);margin-left:8px' });
    const resultsBox = h('div', {
      class: 'student-search-results',
      style: 'position:relative;left:0;right:0;max-height:280px;display:none',
    });

    const imageWarning = h('div', {
      style: 'display:none;background:#fef7e0;border:1.5px solid #f9ab00;color:#b06000;padding:9px 13px;border-radius:8px;font-size:0.83em;margin-top:8px;line-height:1.45'
    });

    const versionsBar = h('div', {
      class: 'board-versions-bar',
      style: 'display:none;margin-top:10px;padding:10px 14px;background:#f8f9fa;border-radius:8px;border:1.5px solid var(--line,#e0e0e0);box-sizing:border-box'
    });

    function renderThumbs() {
      imageCountLabel.innerHTML = `<b>Images (${imgs.length} / 5)</b> — ${imgs.length >= 5
        ? '<span style="color:#d93025;font-weight:600">Maximum 5 reached. Click ✕ to delete an image if you wish to replace it.</span>'
        : 'Old images are kept! Click <b>➕ Add image</b> to upload more, or <b>✕</b> to delete.'}`;

      const cards = imgs.map((src, idx) => {
        return h('div', {
          style: 'position:relative;display:flex;flex-direction:column;border-radius:8px;overflow:hidden;border:1.5px solid var(--line,#e0e0e0);background:#fff;box-shadow:0 2px 5px rgba(0,0,0,0.08);width:115px'
        },
          h('div', {
            style: 'position:relative;width:115px;height:90px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:zoom-in',
            onclick: () => lightbox(src, `Image ${idx + 1}`)
          },
            h('img', { src, alt: `Image ${idx + 1}`, style: 'width:100%;height:100%;object-fit:cover;display:block' }),
            h('button', {
              type: 'button',
              title: 'Delete this image',
              style: 'position:absolute;top:4px;right:4px;background:#d93025;color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,0.35)',
              onclick: (e) => {
                e.stopPropagation();
                imgs.splice(idx, 1);
                renderThumbs();
              }
            }, '✕')
          ),
          h('div', {
            style: 'padding:4px 6px;background:#fafafa;border-top:1px solid var(--line,#eee);display:flex;align-items:center;justify-content:space-between'
          },
            h('span', { style: 'font-size:0.72em;color:var(--muted);font-weight:600' }, `Image ${idx + 1}`),
            h('button', {
              type: 'button',
              title: 'Open in new browser tab',
              style: 'border:1px solid #d0d7de;background:#fff;border-radius:4px;padding:2px 5px;font-size:0.7em;cursor:pointer;font-weight:600;color:#0969da;display:flex;align-items:center;gap:2px',
              onclick: (e) => {
                e.stopPropagation();
                openInNewTab(src, `${f.refs?.name?.value || 'Component'} - Image ${idx + 1}`);
              }
            }, '↗ Tab')
          )
        );
      });

      const addCard = imgs.length < 5 ? h('button', {
        type: 'button',
        class: 'btn sm gold',
        style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:115px;height:120px;border:2px dashed #e0a800;border-radius:8px;background:rgba(255,193,7,0.08);cursor:pointer;transition:all .15s',
        onclick: (e) => {
          e.preventDefault();
          pick.click();
        }
      },
        h('span', { style: 'font-size:1.6em' }, '➕'),
        h('span', { style: 'font-size:0.8em;font-weight:700;color:var(--ink)' }, 'Add image'),
        h('span', { style: 'font-size:0.68em;color:var(--muted)' }, `(${5 - imgs.length} left)`)
      ) : null;

      thumbs.replaceChildren(...cards, addCard);

      if (imgs.length > 0) {
        imageWarning.style.display = 'none';
        pick.style.outline = 'none';
      }
    }

    // If editing existing component, load existing images so old images are visible and preserved!
    if (c && c.compId) {
      api(`/api/catalog/${code}/components/${c.compId}/images`).then(existing => {
        if (existing && existing.length) {
          imgs = [...existing];
          renderThumbs();
        }
      }).catch(() => {});
    }

    function renderVersionsBar(family, activeVariantName) {
      if (!family || !family.variants || family.variants.length <= 1) {
        versionsBar.style.display = 'none';
        versionsBar.replaceChildren();
        return;
      }
      versionsBar.style.display = 'block';
      versionsBar.replaceChildren(
        h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:4px' },
          h('span', { style: 'font-size:0.85em;font-weight:700;color:var(--ink,#222)' },
            `🎛️ Revisions / Versions of ${family.familyName}:`
          ),
          h('span', { style: 'font-size:0.75em;color:var(--muted,#777)' }, 'Click any version to switch specs & photo')
        ),
        h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
          ...family.variants.map(v => {
            const isActive = v.name === activeVariantName;
            return h('button', {
              type: 'button',
              class: 'btn sm ' + (isActive ? 'primary' : 'ghost'),
              style: isActive
                ? 'background:#1a73e8;color:#fff;border-color:#1a73e8;font-weight:600'
                : 'background:#fff;border:1px solid #ccc;color:#333',
              onclick: (e) => {
                e.preventDefault();
                applyResult(v.name, v);
              }
            }, v.tag || v.name);
          })
        )
      );
    }

    async function applyResult(title, variant = null) {
      statusLine.textContent = '⏳ Loading details…';
      resultsBox.style.display = 'none';
      resultsBox.replaceChildren();
      searchInput.value = title;
      imageWarning.style.display = 'none';
      pick.style.outline = 'none';

      try {
        let cat = 'Board';
        let matchedFamily = null;

        // Check if there is a known variant or family
        if (variant) {
          f.refs.name.value = variant.name;
          f.refs.specifications.value = variant.specifications || '';
          cat = variant.category || 'Board';
          f.refs.category.value = cat;

          // Find family for revision switcher
          for (const fam of Object.values(KNOWN_VARIANTS)) {
            if (fam.variants.some(x => x.name === variant.name)) {
              matchedFamily = fam;
              break;
            }
          }
        } else {
          // Check if title matches any known variant family
          const ql = title.toLowerCase().trim();
          for (const [key, fam] of Object.entries(KNOWN_VARIANTS)) {
            if (ql.includes(key) || key.includes(ql) || fam.variants.some(v => v.name.toLowerCase() === ql)) {
              matchedFamily = fam;
              // If title matches a specific variant, use it
              const exact = fam.variants.find(v => v.name.toLowerCase() === ql);
              if (exact) {
                variant = exact;
                f.refs.name.value = exact.name;
                f.refs.specifications.value = exact.specifications || '';
                cat = exact.category || 'Board';
                f.refs.category.value = cat;
                break;
              }
            }
          }

          if (!variant) {
            const page = await fetchWikiSummary(title);
            f.refs.name.value = page.title || title;
            const spec = (page.extract_html
              ? page.extract_html.replace(/<[^>]+>/g, ' ')
              : page.extract || ''
            ).replace(/\s+/g, ' ').trim().slice(0, 400);
            f.refs.specifications.value = spec;
            cat = guessCategory(page.title, page.extract || '', page.description || '');
            f.refs.category.value = cat;
          }
        }

        // Render the revision switcher bar if a family exists
        if (matchedFamily) {
          renderVersionsBar(matchedFamily, f.refs.name.value);
        } else {
          renderVersionsBar(null);
        }

        // ── Image Resolution ──
        statusLine.textContent = '⏳ Fetching photos…';
        let dataUrls = [];
        try {
          if (variant && variant.imageFiles && variant.imageFiles.length > 0) {
            dataUrls = await fetchImagesByFilenames(variant.imageFiles);
          }
          if (dataUrls.length === 0) {
            dataUrls = await fetchWikiImages(title);
          }
          // If fewer than 3 and we have summary thumbnail, try adding it
          if (dataUrls.length < 3 && !variant) {
            try {
              const page = await fetchWikiSummary(title);
              const imgUrl = page.thumbnail?.source || page.originalimage?.source;
              if (imgUrl) {
                const r = await fetch(imgUrl);
                if (r.ok) {
                  const blob = await r.blob();
                  const dataUrl = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                  });
                  dataUrls.unshift(dataUrl);
                }
              }
            } catch {}
          }
        } catch {
          // Non-blocking
        }

        if (dataUrls.length > 0) {
          // Append new images without replacing existing ones (up to 5 total)
          const remaining = 5 - imgs.length;
          if (remaining > 0) {
            imgs = [...imgs, ...dataUrls.slice(0, remaining)];
          } else if (imgs.length === 0) {
            imgs = dataUrls.slice(0, 3);
          }
          renderThumbs();
          imageWarning.style.display = 'none';
          pick.style.outline = 'none';
          statusLine.textContent = `✅ Auto-filled — category: "${cat}" · ${imgs.length} image(s) total`;
        } else {
          if (imgs.length === 0) {
            renderThumbs();
            statusLine.innerHTML = '⚠️ <span style="color:#d93025;font-weight:600">No image found online — please attach manually below</span>';
            imageWarning.style.display = 'block';
            imageWarning.innerHTML = '⚠️ <b>No image found online for this board:</b> Please take a photo or select an image file from your device to attach it manually.';
            pick.style.outline = '2px dashed #ea8600';
            pick.style.borderRadius = '6px';
          }
        }
      } catch (e) {
        statusLine.textContent = `❌ ${e.message}`;
      }
    }

    let suggestTimer;
    const searchInput = h('input', {
      placeholder: 'Type component name… (e.g. Arduino Uno, DHT11, 7408)',
      style: 'flex:1',
      oninput: () => {
        clearTimeout(suggestTimer);
        const val = searchInput.value.trim();
        if (val.length < 2) { resultsBox.style.display = 'none'; resultsBox.replaceChildren(); return; }
        statusLine.textContent = '🔍 Searching…';
        suggestTimer = setTimeout(async () => {
          try {
            const items = await wikiSuggest(val);
            if (!items.length) {
              resultsBox.replaceChildren(h('div', { class: 'search-result-empty', style: 'padding:10px 14px;color:var(--muted)' }, 'No matching components found'));
            } else {
              resultsBox.replaceChildren(...items.map(item => {
                let tag = null;
                if (item.badge) tag = h('span', { class: 'badge', style: 'font-size:0.7em;background:#e8f0fe;color:#1967d2;padding:2px 6px;border-radius:4px;font-weight:600;flex-shrink:0' }, item.badge);
                else if (item.isBoard) tag = h('span', { class: 'badge', style: 'font-size:0.7em;background:#e8f0fe;color:#1967d2;padding:2px 6px;border-radius:4px;font-weight:600;flex-shrink:0' }, 'Board');
                else if (item.isSensor) tag = h('span', { class: 'badge', style: 'font-size:0.7em;background:#e6f4ea;color:#137333;padding:2px 6px;border-radius:4px;font-weight:600;flex-shrink:0' }, 'Sensor');
                else if (item.isLogicGate) tag = h('span', { class: 'badge', style: 'font-size:0.7em;background:#fef7e0;color:#b06000;padding:2px 6px;border-radius:4px;font-weight:600;flex-shrink:0' }, 'Logic Gate');

                return h('button', {
                  class: 'search-result-item',
                  type: 'button',
                  style: 'display:flex;flex-direction:row;align-items:center;gap:12px;width:100%;text-align:left;padding:8px 14px;border:none;background:none;cursor:pointer;border-bottom:1px solid var(--line,#e0e0e0);box-sizing:border-box',
                  onmousedown: (e) => { e.preventDefault(); applyResult(item.title, item.variant); },
                },
                  item.thumb ? h('img', { src: item.thumb, style: 'width:38px;height:38px;object-fit:cover;border-radius:6px;flex-shrink:0;border:1px solid var(--line,#eee)' }) : null,
                  h('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px' },
                    h('div', { style: 'font-weight:600;font-size:0.9em;color:var(--ink,#222);white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, item.title),
                    item.desc ? h('div', { style: 'font-size:0.75em;color:var(--muted,#777);white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, item.desc) : null,
                  ),
                  tag
                );
              }));
            }
            resultsBox.style.display = 'block';
            statusLine.textContent = '';
          } catch { statusLine.textContent = '❌ Search failed'; }
        }, 320);
      },
      onblur: () => setTimeout(() => { resultsBox.style.display = 'none'; }, 180),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = resultsBox.querySelector('button'); if (first) first.click(); } },
    });

    const autoFillBlock = h('div', { class: 'student-search-block' },
      h('div', { class: 'field' },
        h('div', { class: 'row', style: 'align-items:center;gap:6px;flex-wrap:wrap' },
          h('span', { style: 'font-weight:600;white-space:nowrap' }, '🌐 Smart Auto-fill'),
          statusLine,
        ),
        h('div', { style: 'position:relative' },
          searchInput,
          resultsBox,
        ),
        h('p', { style: 'font-size:0.75em;color:var(--muted,#888);margin:2px 0 0' },
          'Type to search — name, category & image are filled automatically from Wikipedia'),
        versionsBar,
      ),
    );
    // ─────────────────────────────────────────────────────────────────────────

    const pick = h('input', {
      type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async (e) => {
        if (!e.target.files.length) return;
        try {
          const remaining = 5 - imgs.length;
          if (remaining <= 0) {
            toast('Maximum 5 images allowed per component. Please delete an image first.', 'warn');
            return;
          }
          const newFiles = [...e.target.files].slice(0, remaining);
          const resized = await Promise.all(newFiles.map((x) => resizeImage(x)));
          // Append new images instead of replacing old images!
          imgs = [...imgs, ...resized];
          renderThumbs();
          toast(`Added ${resized.length} image(s). (${imgs.length}/5 total)`);
        } catch (err) { toast(err.message, 'err'); }
        finally { pick.value = ''; }
      }
    });

    modal(c ? `Edit ${c.compId}` : 'Add component', h('div', { class: 'stack' },
      !c && autoFillBlock,
      f.el,
      h('div', { class: 'field' },
        imageCountLabel,
        thumbs,
        imageWarning
      ),
      pick
    ),
      [{
        label: c ? 'Save changes' : 'Add component', cls: 'green', run: async (close) => {
          const body = { ...f.values(), images: imgs };
          const r = await api(c ? `${base}/${c.compId}` : base, { method: c ? 'PUT' : 'POST', body });
          toast(c ? 'Component updated.' : `Added ${r.compId}`); close(); load();
        }
      }]);
  }

  async function remove(c) {
    if (!confirm(`Permanently delete ${c.compId} and its transaction history?`)) return;
    try { await api(`${base}/${c.compId}`, { method: 'DELETE' }); toast('Component deleted.'); load(); } catch (e) { toast(e.message, 'err'); }
  }

  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  await load();
  return {
    el: h('div', {}, stats, h('div', { class: 'row', style: 'margin-bottom:12px' }, h('div', { class: 'grow' }, q), h('button', { class: 'btn gold', onclick: () => edit(null) }, '+ Add component')),
      h('div', { class: 'tbl-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Code', 'Name', 'Category', 'Specs', 'Total', 'Issued', 'Available', 'Images', ''].map((x) => h('th', {}, x)))), tbody)))
  };
}