'use strict';

const marked = require('marked');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const xmljs = require('xml-js');
const { highlight } = require('highlight.js');

const datesFilename = path.join(__dirname, 'source', 'dates.json');

marked.setOptions({
  renderer: new marked.Renderer(),
  highlight: (code, language) => highlight(code, { language }).value,
  pedantic: false,
  gfm: true,
  breaks: false,
  sanitize: false,
  smartLists: true,
  smartypants: false,
  xhtml: false
});

function convertMarkedToHtml(html) {
  return html.replace(/<img /g, '<img class="img-fluid" ').replace(/<pre><code class="/g, '<pre class="code-padding"><code class="hljs code-padding ');
}

function replaceRelativeUrls(html) {
  return html
    .replace(/src="([^.]+)\.([^"]+)"/g, 'src="https://deadcode.dev/$1/$1.$2"')
    .replace(/href="\.\.\/(\d+)\/(["]*)"/g, 'href="https://deadcode.dev/$1/"');
}

async function renderFile(id, sourceFilename) {
  const s = fs.statSync(sourceFilename);
  const date = s.ctime;

  const markdownStrings = fs.readFileSync(sourceFilename).toString().split("\n");

  const title = markdownStrings.shift();
  let preview = null;

  if (markdownStrings[0].startsWith('preview ')) {
    preview = markdownStrings.shift().substr(8).trim();
  }

  const joinedString = markdownStrings.join("\n");
  const htmlMarkdown = marked(joinedString);

  if (!preview) {
    preview = joinedString.substr(0, 100);
  }

  const _possiblyTrimPos = preview.indexOf('```');
  if (_possiblyTrimPos >= 0) {
    preview = preview.substr(0, _possiblyTrimPos);
  }

  const renderedHtml = await ejs.renderFile('template.ejs', { id, title, html: htmlMarkdown }, { async: true });

  return {
    title,
    preview,
    html: convertMarkedToHtml(renderedHtml),
    rssHtml: replaceRelativeUrls(convertMarkedToHtml(htmlMarkdown)),
    date
  };
}

function generateRss(items) {
  /* eslint-disable quote-props */
  const js = {
    _declaration: {
      _attributes: {
        version: '1.0',
        encoding: 'utf-8'
      }
    },
    rss: {
      _attributes: {
        version: '2.0',
        'xmlns:atom': 'http://www.w3.org/2005/Atom'
      },


      channel: {
        image: {
          url: 'https://deadcode.dev/rss2.png',
          title: 'Деды писали код',
          link: 'https://deadcode.dev/'
        },

        'atom:link': {
          _attributes: {
            href: 'https://deadcode.dev/rss2.xml',
            rel: 'self',
            type: 'application/rss+xml'
          }
        },

        title: 'Деды писали код',
        description: 'Telegram канал с ежедневным советом по программированию',
        link: 'https://deadcode.dev/',
        language: 'ru',
        copyright: '2020 Егор Егоров | me@egorfine.com',
        pubDate: items[0].pubDate,

        item: items
      }
    }
  };
  /* eslint-enable quote-props */

  const options = { compact: true, spaces: 2 };

  const rssXml = xmljs.js2xml(js, options);

  const rssFilename = path.join(__dirname, 'web', 'rss2.xml');

  const oldRss = fs.readFileSync(rssFilename).toString();
  if (oldRss != rssXml) {
    console.log("RSS updated");
    fs.writeFileSync(rssFilename, rssXml);
  }
}

(async function() {
  const datesById = JSON.parse(fs.readFileSync(datesFilename).toString());

  const files = fs.readdirSync(path.join(__dirname, 'source')).filter(name => name.endsWith('.md') && name.indexOf('-') < 0);
  files.sort();

  const rootEntries = [], rssItems = [];

  for (const filename of files) {
    const id = filename.replace('.md', '');

    const { title, preview, html, rssHtml, date } = await renderFile(id, path.join('source', filename));

    if (!datesById[id]) {
      datesById[id] = date;
    }

    rootEntries.push({
      id,
      title,
      preview
    });

    const url = 'https://deadcode.dev/' + id + '/';

    rssItems.push({
        title,
        link: url,
        guid: {
          _attributes: {
            isPermaLink: 'true'
          },
          _text: url
        },
        pubDate: new Date(datesById[id]).toUTCString(),
        description: {
          _cdata: rssHtml
        },
        author: 'me@egorfine.com (Егор Егоров)'
    });

    const targetDir = path.join(__dirname, 'web', id);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir);
    }

    const imageFilename = id + '.png';
    const fullImageFilename = path.join(__dirname, 'source', imageFilename);
    if (fs.existsSync(fullImageFilename)) {
      fs.copyFileSync(fullImageFilename, path.join(__dirname, 'web', id, imageFilename));
    }

    const targetFilename = path.join(targetDir, 'index.html');
    if (fs.existsSync(targetFilename)) {
      const previousHtml = fs.readFileSync(targetFilename).toString();
      if (previousHtml == html) {
        continue;
      }
    }

    fs.writeFileSync(targetFilename, html);
  }

  rootEntries.reverse();

  const rootHtml = await ejs.renderFile('index.ejs', { rootEntries }, { async: true });
  fs.writeFileSync(path.join(__dirname, 'web', 'index.html'), rootHtml);

  fs.writeFileSync(datesFilename, JSON.stringify(datesById, null, "\t") + "\n");

  rssItems.reverse();
  generateRss(rssItems);
}());
