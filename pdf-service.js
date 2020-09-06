const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
const bodyParser = require('body-parser');

app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({
    extended: true,
    limit: '100mb',
    parameterLimit: 1000,
})); // support encoded bodies

let port = 3000;
let calls = {
    health: 0,
    fromUrl: 0,
    fromHtml: 0,
};
let isReady = false;
let browser = null;
let storagePath = 'storage';

app.get('/health', (req, res) => {
    calls.health++;
    console.log('serving /health');
    deliverJson(res, {isReady, calls}, isReady ? 200 : 503);
});

app.post('/from-html', async (req, res) => {
    calls.fromHtml++;
    const html = req.body.html;
    const htmlFile = md5(html.substr(0, 100)) + '.html';
    const fullHtmlPath = path.join(__dirname, storagePath, htmlFile);

    fs.writeFileSync(fullHtmlPath, html);

    let pdfFilePath;
    try {
        pdfFilePath = await generatePdf(`file://${fullHtmlPath}`, req.query.media);
    } catch (err) {
        console.log('/from-html: error generating PDF', e);
        let msg = 'failure generating PDF';
        deliverJson(res, {msg, err}, 500);
        return;
    }

    deliverPdfFile(res, pdfFilePath);
    fs.unlinkSync(fullHtmlPath);
});

app.get('/from-url', async (req, res) => {
    calls.fromUrl++;
    const url = req.query.url;
    console.log('/from-url');

    if (!url) {
        let msg = 'missing parameter: \'url\'';
        deliverJson(res, {msg, params: req.params}, 400);
        return;
    }

    let pdfFilePath;
    try {
        pdfFilePath = await generatePdf(url, req.query.media);
    } catch (err) {
        console.log('/from-url: error generating PDF', e);
        let msg = 'failure generating PDF';
        deliverJson(res, {msg, err}, 500);
        return;
    }

    deliverPdfFile(res, pdfFilePath);
});

function deliverJson(res, resp, status = 200) {
    res.status(status).contentType('json').send(resp);
}

function deliverPdfFile(res, pdfFilePath) {
    console.log('deliverPdfFile: going to deliver PDF', pdfFilePath);
    const reader = fs.createReadStream(pdfFilePath);
    res.setHeader('Content-Length', fs.statSync(pdfFilePath).size);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    reader.pipe(res);

    console.log('deliverPdfFile: going to remove file', pdfFilePath);
    fs.unlinkSync(pdfFilePath);
}

async function generatePdf(url, media) {
    console.log('generatePdf: browser.newPage');
    const page = await browser.newPage();

    console.log('generatePdf: emulateMediaType');
    await page.emulateMediaType(media || 'screen');

    await page.setViewport({
        width: 1200,
        height: 800,
        isMobile: false,
    });

    console.log('generatePdf: goto', url);
    await page.goto(url, {
        waitUntil: 'networkidle2',
    });

    let filename = md5(url) + '.pdf';
    const pdfFolder = path.join(__dirname, storagePath);
    if (!fs.existsSync(pdfFolder)) {
        fs.mkdirSync(pdfFolder);
    }
    const pdfFilePath = path.join(pdfFolder, filename);

    console.log('generatePdf: generate PDF', pdfFilePath);
    await page.pdf({
        path: pdfFilePath,
        scale: parseFloat(1),
        format: 'A4',
        printBackground: true,
        // displayHeaderFooter: false,
        // landscape: false,
    });

    return pdfFilePath;
}

function md5(seed) {
    return crypto.createHash('md5').update(seed).digest('hex');
}

app.listen(port, () => {
    console.log(`Kool PDF service running at port ${port}`);
    console.log('Going to start puppeter');

    (async () => {
        browser = await puppeteer.launch({
            args: [
                '--headless',
                '--no-sandbox',
                '--disable-dev-shm-usage',
            ],
        });

        console.log('Started puppeteer; setting service state to Ready');
        isReady = true;
    })();
});
