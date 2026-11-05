import './styles.css';
import { Game } from './game';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const ui = document.querySelector<HTMLElement>('#ui');

if (!canvas || !ui) {
  throw new Error('Missing #scene or #ui root element');
}

try {
  new Game(canvas, ui).start();
} catch (error) {
  console.error(error);
  const message = document.createElement('p');
  message.className = 'fatal';
  message.textContent = 'Sorry — this device or browser could not start WebGL.';
  ui.replaceChildren(message);
}
