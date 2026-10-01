import { countText } from './counts.js';

const sample = `A short note can carry a lot.

Text Meter keeps the numbers out of your way until you need them.`;

const input = document.querySelector('#text-input');
const emptyState = document.querySelector('#empty-state');
const metrics = {
  characters: document.querySelector('#character-count'),
  nonWhitespaceCharacters: document.querySelector('#non-whitespace-count'),
  words: document.querySelector('#word-count'),
  lines: document.querySelector('#line-count'),
};

function updateCounts() {
  const counts = countText(input.value);
  Object.entries(metrics).forEach(([key, element]) => {
    element.textContent = counts[key].toLocaleString();
  });
  emptyState.hidden = input.value.length > 0;
}

document.querySelector('#clear-button').addEventListener('click', () => {
  input.value = '';
  updateCounts();
  input.focus();
});

document.querySelector('#sample-button').addEventListener('click', () => {
  input.value = sample;
  updateCounts();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

input.addEventListener('input', updateCounts);
updateCounts();
