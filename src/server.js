import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const dataFile = process.env.DATA_FILE || '.data/boundarylab.json';
const production = process.env.NODE_ENV === 'production';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const { server } = createApp({ dataFile, production });
server.listen(port, '0.0.0.0', () => {
  console.log(`BoundaryLab running at http://localhost:${port}`);
  console.log(`Storage path: ${dataFile}`);
  console.log('Local project demo; do not expose directly to the public Internet.');
});
