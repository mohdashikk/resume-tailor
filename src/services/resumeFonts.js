const fonts = [ ['normal', 'Inter-Regular.ttf'], ['bold', 'Inter-Bold.ttf'] ];
let fontData;
export async function registerResumeFonts(doc) {
  fontData ||= Promise.all(fonts.map(async ([style, file]) => {
    try {
      let bytes;
      if (typeof process !== 'undefined' && process.versions?.node) {
        const { readFile } = await import(/* @vite-ignore */ ['node:fs', 'promises'].join('/'));
        bytes = await readFile(`${process.cwd()}/public/fonts/${file}`);
      } else {
        const response = await fetch(`${import.meta.env.BASE_URL}fonts/${file}`);
        if (!response.ok) throw new Error(`Unable to load ${file}`);
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { style, file, data: btoa(binary) };
    } catch (error) { fontData = undefined; throw error; }
  }));
  for (const { style, file, data } of await fontData) {
    doc.addFileToVFS(file, data);
    doc.addFont(file, 'Inter', style);
  }
}
