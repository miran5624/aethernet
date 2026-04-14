const { Jimp } = require('jimp');
const path = require('path');
const { existsSync } = require('fs');

const BASE = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

const SIZES = {
  'mipmap-mdpi':    48,
  'mipmap-hdpi':    72,
  'mipmap-xhdpi':   96,
  'mipmap-xxhdpi':  144,
  'mipmap-xxxhdpi': 192,
};

const SRC = path.join(__dirname, 'icon_source.png');
if (!existsSync(SRC)) {
  console.error('ERROR: Place the satellite dish PNG at scripts/icon_source.png and re-run.');
  process.exit(1);
}

(async () => {
  const img = await Jimp.read(SRC);

  // Crop to square from centre using object form required by Jimp v1
  const min = Math.min(img.width, img.height);
  img.crop({
    x: Math.floor((img.width - min) / 2),
    y: Math.floor((img.height - min) / 2),
    w: min,
    h: min,
  });

  for (const [folder, size] of Object.entries(SIZES)) {
    const copy = img.clone();
    copy.resize({ w: size, h: size });   // object form
    await copy.write(path.join(BASE, folder, 'ic_launcher.png'));
    await copy.write(path.join(BASE, folder, 'ic_launcher_round.png'));
    console.log(`✓ ${folder}  (${size}x${size})`);
  }
  console.log('\nDone — rebuild with: npx react-native run-android');
})().catch(e => { console.error(e.message || e); process.exit(1); });
