const form = document.getElementById('form');
const urlInput = document.getElementById('urlInput');
const message = document.getElementById('message');
const loader = document.getElementById('loader');
const report = document.getElementById('report');
const cards = document.getElementById('cards');
const historyBox = document.getElementById('history');
const siteFrame = document.getElementById('siteFrame');
const previewStatus = document.getElementById('previewStatus');
const browserUrl = document.getElementById('browserUrl');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const themeBtn = document.getElementById('themeBtn');
const copyBtn = document.getElementById('copyBtn');
const printBtn = document.getElementById('printBtn');
const summary = document.getElementById('summary');

const HISTORY_KEY = 'webinspector_apple_history_v1';
const THEME_KEY = 'webinspector_apple_theme_v1';

let currentResult = null;

init();

function init() {
  document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || 'light';
  renderHistory();
}

form.addEventListener('submit', async function (event) {
  event.preventDefault();

  try {
    const url = normalizeUrl(urlInput.value);
    await runAnalysis(url);
  } catch (error) {
    showMessage(error.message, true);
  }
});

themeBtn.addEventListener('click', function () {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_KEY, nextTheme);
});

copyBtn.addEventListener('click', async function () {
  if (!currentResult) {
    showMessage('Сначала выполните анализ сайта.', true);
    return;
  }

  try {
    await navigator.clipboard.writeText(buildTextReport(currentResult));
    showMessage('Отчет скопирован в буфер обмена.', false);
  } catch (error) {
    showMessage('Браузер заблокировал доступ к буферу обмена.', true);
  }
});

printBtn.addEventListener('click', function () {
  window.print();
});

clearHistoryBtn.addEventListener('click', function () {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  showMessage('История проверок очищена.', false);
});

/*
  Функция приводит введенный адрес к нормальному виду.
  Пользователь может написать example.com, а приложение само добавит https://.
  Проверка через new URL нужна, чтобы отсеять неправильные адреса.
*/
function normalizeUrl(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Введите URL сайта.');
  }

  const prepared = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
  const url = new URL(prepared);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Разрешены только ссылки http и https.');
  }

  if (!url.hostname.includes('.')) {
    throw new Error('Введите корректный адрес сайта, например example.com.');
  }

  return url.href;
}

/*
  Главная функция анализа.
  Она показывает загрузку, вставляет сайт в iframe для просмотра,
  получает HTML через прокси и затем запускает разбор страницы.
*/
async function runAnalysis(url) {
  setLoading(true);
  showMessage('Получаем HTML страницы и собираем метрики...', false);

  siteFrame.src = url;
  previewStatus.textContent = 'загрузка';
  browserUrl.textContent = url;

  const start = performance.now();

  try {
    const html = await loadHtml(url);
    const loadTime = ((performance.now() - start) / 1000).toFixed(2);
    const result = analyzeHtml(url, html, loadTime);

    currentResult = result;
    renderReport(result);
    saveToHistory(result);
    renderHistory();

    previewStatus.textContent = 'готово';
    showMessage('Анализ завершен.', false);
  } catch (error) {
    previewStatus.textContent = 'ограничено';
    showMessage('Не удалось получить HTML сайта: ' + error.message, true);
  } finally {
    setLoading(false);
  }
}

/*
  Прямой fetch чужого сайта часто блокируется из-за CORS.
  Поэтому используется бесплатный прокси AllOrigins.
  Это позволяет получить HTML публичной страницы и разобрать его.
*/
async function loadHtml(url) {
  const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
  const response = await fetch(proxyUrl);

  if (!response.ok) {
    throw new Error('ошибка запроса ' + response.status);
  }

  const text = await response.text();

  if (!text || text.trim().length < 20) {
    throw new Error('получен пустой ответ');
  }

  return text;
}

/*
  DOMParser превращает строку HTML в документ.
  После этого можно искать title, meta, h1, h2, img, a обычными querySelector.
*/
function analyzeHtml(url, html, loadTime) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const parsedUrl = new URL(url);

  const metrics = {
    url,
    title: getTitle(doc),
    description: getMeta(doc, 'description'),
    keywords: getMeta(doc, 'keywords'),
    h1: doc.querySelectorAll('h1').length,
    h2: doc.querySelectorAll('h2').length,
    h3: doc.querySelectorAll('h3').length,
    images: doc.querySelectorAll('img').length,
    links: doc.querySelectorAll('a').length,
    ssl: parsedUrl.protocol === 'https:',
    viewport: Boolean(getMeta(doc, 'viewport')),
    loadTime
  };

  const items = buildRecommendations(metrics);

  return {
    id: Date.now(),
    date: new Date().toLocaleString('ru-RU'),
    metrics,
    items,
    counts: countItems(items)
  };
}

function getTitle(doc) {
  const title = doc.querySelector('title');
  return title ? title.textContent.trim() : '';
}

function getMeta(doc, name) {
  const meta = doc.querySelector('meta[name="' + name + '"]');
  return meta ? meta.getAttribute('content')?.trim() || '' : '';
}

/*
  Здесь находится основная логика рекомендаций.
  Каждое правило проверяет одну метрику и добавляет карточку:
  critical — ошибка, warning — предупреждение, success — успешная проверка.
*/
function buildRecommendations(metrics) {
  const items = [];

  items.push({
    type: 'stats',
    icon: '📊',
    title: 'Статистика страницы',
    text: 'Собраны основные числовые показатели сайта.',
    details: [
      'Title: ' + (metrics.title || 'не найден'),
      'Description: ' + (metrics.description ? 'есть' : 'нет'),
      'Keywords: ' + (metrics.keywords ? 'есть' : 'нет'),
      'H1: ' + metrics.h1,
      'H2: ' + metrics.h2,
      'H3: ' + metrics.h3,
      'Изображения: ' + metrics.images,
      'Ссылки: ' + metrics.links,
      'Время загрузки: ~' + metrics.loadTime + 'с'
    ].join(' | ')
  });

  if (metrics.title) {
    addSuccess(items, 'Title найден', 'У страницы есть корректное название.', 'Title помогает пользователям и поисковым системам понять тему страницы.');
  } else {
    addCritical(items, 'Отсутствует title', 'Добавьте title для улучшения SEO.', 'Title должен кратко описывать страницу и содержать основную тему.');
  }

  if (metrics.description) {
    addSuccess(items, 'Meta-description найден', 'У страницы есть SEO-описание.', 'Описание может использоваться в поисковой выдаче как сниппет.');
  } else {
    addCritical(items, 'Нет meta-description', 'Добавьте описание страницы.', 'Оптимальная длина description обычно составляет примерно 120–160 символов.');
  }

  if (metrics.h1) {
    addSuccess(items, 'H1 найден', 'На странице есть главный заголовок.', 'Обычно на странице используют один основной H1.');
  } else {
    addCritical(items, 'Нет заголовка H1', 'Добавьте главный заголовок страницы.', 'H1 помогает определить главную тему страницы.');
  }

  if (metrics.h2 + metrics.h3 < 3) {
    addWarning(items, 'Мало подзаголовков', 'Добавьте больше H2 и H3 для структуры.', 'Подзаголовки улучшают читаемость и помогают разделить контент на смысловые блоки.');
  } else {
    addSuccess(items, 'Структура заголовков хорошая', 'На странице достаточно подзаголовков.', 'Контент выглядит структурированным.');
  }

  if (metrics.links > 50) {
    addWarning(items, 'Слишком много ссылок', 'Проверьте качество и необходимость ссылок.', 'Избыточное количество ссылок может перегружать страницу.');
  } else {
    addSuccess(items, 'Количество ссылок нормальное', 'На странице нет чрезмерного количества ссылок.', 'Ссылочная структура выглядит умеренной.');
  }

  if (metrics.ssl) {
    addSuccess(items, 'HTTPS включен', 'Сайт работает по защищенному протоколу.', 'SSL повышает доверие пользователей и безопасность передачи данных.');
  } else {
    addCritical(items, 'Нет HTTPS', 'Рекомендуется перейти на HTTPS.', 'HTTP-сайты могут помечаться браузером как небезопасные.');
  }

  if (metrics.viewport) {
    addSuccess(items, 'Viewport найден', 'Страница подготовлена для мобильных устройств.', 'Наличие viewport является базовым признаком адаптивной верстки.');
  } else {
    addWarning(items, 'Нет viewport', 'Добавьте meta viewport.', 'Пример: <meta name="viewport" content="width=device-width, initial-scale=1.0">');
  }

  if (Number(metrics.loadTime) <= 1) {
    addSuccess(items, 'Быстрая загрузка', 'Страница получила ответ быстрее 1 секунды.', 'Проверка примерная, потому что запрос выполняется через прокси.');
  } else {
    addWarning(items, 'Загрузка может быть медленной', 'Проверьте изображения, CSS и JavaScript.', 'Оптимизация ресурсов помогает улучшить пользовательский опыт.');
  }

  return items;
}

function addCritical(items, title, text, details) {
  items.push({ type: 'critical', icon: '❌', title, text, details });
}

function addWarning(items, title, text, details) {
  items.push({ type: 'warning', icon: '⚠️', title, text, details });
}

function addSuccess(items, title, text, details) {
  items.push({ type: 'success', icon: '✅', title, text, details });
}

function countItems(items) {
  return {
    critical: items.filter(item => item.type === 'critical').length,
    warning: items.filter(item => item.type === 'warning').length,
    success: items.filter(item => item.type === 'success').length,
    stats: items.filter(item => item.type === 'stats').length
  };
}

/*
  Отчет создается через document.createElement и textContent.
  Это безопаснее, чем innerHTML, потому что данные сайта не вставляются как HTML-код.
*/
function renderReport(result) {
  cards.textContent = '';
  summary.textContent = '';
  report.classList.add('visible');

  createSummaryPill('Ошибки: ' + result.counts.critical);
  createSummaryPill('Предупреждения: ' + result.counts.warning);
  createSummaryPill('Успехи: ' + result.counts.success);

  result.items.forEach(function (item, index) {
    const card = document.createElement('article');
    card.className = 'audit-card ' + item.type;
    card.style.animationDelay = index * 0.045 + 's';

    const top = document.createElement('div');
    top.className = 'card-top';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'card-title';

    const icon = document.createElement('span');
    icon.className = 'card-icon';
    icon.textContent = item.icon;

    const textBox = document.createElement('div');

    const title = document.createElement('strong');
    title.textContent = item.title;

    const text = document.createElement('p');
    text.textContent = item.text;

    textBox.append(title, text);
    titleWrap.append(icon, textBox);

    const button = document.createElement('button');
    button.className = 'details-btn';
    button.type = 'button';
    button.textContent = 'Подробнее';

    const details = document.createElement('div');
    details.className = 'card-details';
    details.textContent = item.details;

    button.addEventListener('click', function () {
      card.classList.toggle('open');
      button.textContent = card.classList.contains('open') ? 'Скрыть' : 'Подробнее';
    });

    top.append(titleWrap, button);
    card.append(top, details);
    cards.append(card);
  });

  report.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function createSummaryPill(text) {
  const pill = document.createElement('span');
  pill.className = 'summary-pill';
  pill.textContent = text;
  summary.append(pill);
}

/*
  История хранится в localStorage.
  Перед сохранением удаляется старая проверка такого же URL,
  чтобы в истории не появлялись дубликаты.
*/
function saveToHistory(result) {
  const history = getHistory();
  const withoutDuplicate = history.filter(item => item.metrics.url !== result.metrics.url);
  const nextHistory = [result, ...withoutDuplicate].slice(0, 8);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function renderHistory() {
  const history = getHistory();
  historyBox.textContent = '';

  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Проверок пока нет.';
    historyBox.append(empty);
    return;
  }

  history.forEach(function (item) {
    const button = document.createElement('button');
    button.className = 'history-item';
    button.type = 'button';

    const url = document.createElement('span');
    url.className = 'history-url';
    url.textContent = item.metrics.url;

    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.textContent = item.date + ' · Ошибки: ' + item.counts.critical + ', предупреждения: ' + item.counts.warning + ', успехи: ' + item.counts.success;

    button.append(url, meta);

    button.addEventListener('click', function () {
      currentResult = item;
      siteFrame.src = item.metrics.url;
      browserUrl.textContent = item.metrics.url;
      previewStatus.textContent = 'из истории';
      renderReport(item);
      showMessage('Загружен сохраненный отчет из истории.', false);
    });

    historyBox.append(button);
  });
}

/*
  Текстовый отчет нужен для кнопки "Копировать".
  Он собирается из тех же данных, что и карточки на странице.
*/
function buildTextReport(result) {
  const lines = [
    'WEBINSPECTOR — ОТЧЕТ ПРОВЕРКИ',
    'URL: ' + result.metrics.url,
    'Дата: ' + result.date,
    '',
    'СТАТИСТИКА',
    'Title: ' + (result.metrics.title || 'не найден'),
    'Description: ' + (result.metrics.description ? 'есть' : 'нет'),
    'Keywords: ' + (result.metrics.keywords ? 'есть' : 'нет'),
    'H1: ' + result.metrics.h1,
    'H2: ' + result.metrics.h2,
    'H3: ' + result.metrics.h3,
    'Изображения: ' + result.metrics.images,
    'Ссылки: ' + result.metrics.links,
    'SSL: ' + (result.metrics.ssl ? 'Да' : 'Нет'),
    'Viewport: ' + (result.metrics.viewport ? 'Да' : 'Нет'),
    'Время загрузки: ~' + result.metrics.loadTime + 'с',
    '',
    'РЕКОМЕНДАЦИИ'
  ];

  result.items.forEach(function (item, index) {
    lines.push((index + 1) + '. ' + item.title + ' — ' + item.text);
  });

  return lines.join('\n');
}

function setLoading(isLoading) {
  loader.classList.toggle('active', isLoading);
}

function showMessage(text, isError) {
  message.textContent = text;
  message.classList.toggle('error', Boolean(isError));
}

/*
 * ПРИМЕЧАНИЯ ПО РАЗРАБОТКЕ:
 * 1. Проект разделен на index.html, styles.css и app.js.
 * 2. Анализ HTML выполняется через fetch и прокси AllOrigins из-за CORS.
 * 3. iframe используется только для визуального предпросмотра сайта.
 * 4. История проверок хранится в localStorage.
 * 5. Данные вставляются через DOM-методы и textContent, без innerHTML.
 */
