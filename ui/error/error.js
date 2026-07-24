(function initializeCindraErrorPage(root) {
  'use strict';

  const fallbackMessage = 'Cindra could not complete that request.';
  const errors = root.CindraErrors;
  const messageElement = root.document.getElementById('error-message');
  const closeButton = root.document.getElementById('close-button');

  let requestedMessage = '';
  try {
    requestedMessage = new URL(root.location.href).searchParams.get('message') || '';
  } catch (error) {
    requestedMessage = '';
  }

  messageElement.textContent = errors?.cleanMessage(
    requestedMessage,
    fallbackMessage,
    1000
  ) || fallbackMessage;

  const close = () => root.close();
  closeButton.addEventListener('click', close);
  root.document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  closeButton.focus();
})(globalThis);
