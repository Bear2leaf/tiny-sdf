const INF = 1e20;

export default class TinySDF {
    constructor({
        fontSize = 24,
        buffer = 3,
        radius = 8,
        cutoff = 0.25,
        fontFamily = 'sans-serif',
        fontWeight = 'normal'
    }) {
        this.buffer = buffer;
        this.cutoff = cutoff;
        this.radius = radius;

        // make the canvas size big enough to both have the specified buffer around the glyph
        // for "halo", and account for some glyphs possibly being larger than their font size
        const size = this.size = fontSize + buffer * 4;

        const canvas = this._createCanvas(size);

        const ctx = this.ctx = canvas.getContext('2d');
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left'; // Necessary so that RTL text doesn't have different alignment
        ctx.fillStyle = 'black';

        // temporary arrays for the distance transform
        this.gridOuter = new Float64Array(size * size);
        this.gridInner = new Float64Array(size * size);
        this.f = new Float64Array(size);
        this.z = new Float64Array(size + 1);
        this.v = new Uint16Array(size);
    }

    _createCanvas(size) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        return canvas;
    }

    getMetrics(char) {
        const {
            width: glyphAdvance,
            actualBoundingBoxAscent,
            actualBoundingBoxDescent,
            actualBoundingBoxLeft,
            actualBoundingBoxRight
        } = this.ctx.measureText(char);

        // The integer/pixel part of the top alignment is encoded in metrics.glyphTop
        // The remainder is implicitly encoded in the rasterization
        const glyphTop = Math.floor(actualBoundingBoxAscent);
        const glyphLeft = 0;

        // If the glyph overflows the canvas size, it will be clipped at the bottom/right
        const glyphWidth = Math.min(this.size - this.buffer, Math.ceil(actualBoundingBoxRight - actualBoundingBoxLeft));
        const glyphHeight = Math.min(this.size - this.buffer, Math.ceil(actualBoundingBoxAscent + actualBoundingBoxDescent));

        const width = glyphWidth + 2 * this.buffer;
        const height = glyphHeight + 2 * this.buffer;

        return {width, height, glyphWidth, glyphHeight, glyphTop, glyphLeft, glyphAdvance};
    }

    draw(char, metrics = this.getMetrics(char)) {
        const {width, height, glyphWidth, glyphHeight, glyphTop, glyphLeft, glyphAdvance} = metrics;

        const data = new Uint8ClampedArray(width * height);
        const glyph = {data, width, height, glyphWidth, glyphHeight, glyphTop, glyphLeft, glyphAdvance};
        if (glyphWidth === 0 || glyphHeight === 0) return glyph;

        const {ctx, buffer, gridInner, gridOuter} = this;
        ctx.clearRect(buffer, buffer, glyphWidth, glyphHeight);
        ctx.fillText(char, buffer, buffer + glyphTop + 1);
        const imgData = ctx.getImageData(buffer, buffer, glyphWidth, glyphHeight);

        // Initialize grids outside the glyph range to alpha 0
        gridOuter.fill(INF, 0, width * height);
        gridInner.fill(0, 0, width * height);

        const offset = (width - glyphWidth) >> 1;

        for (let y = 0; y < glyphHeight; y++) {
            for (let x = 0; x < glyphWidth; x++) {
                const j = (y + offset) * width + x + offset;
                const a = imgData.data[4 * (y * glyphWidth + x) + 3] / 255; // alpha value
                gridOuter[j] = a === 1 ? 0 : a === 0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
                gridInner[j] = a === 1 ? INF : a === 0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2);
            }
        }

        edt(gridOuter, width, height, this.f, this.v, this.z);
        edt(gridInner, width, height, this.f, this.v, this.z);

        for (let i = 0; i < width * height; i++) {
            const d = Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i]);
            data[i] = Math.round(255 - 255 * (d / this.radius + this.cutoff));
        }

        return glyph;
    }
}

// 2D Euclidean squared distance transform by Felzenszwalb & Huttenlocher https://cs.brown.edu/~pff/papers/dt-final.pdf
function edt(data, width, height, f, v, z) {
    for (let x = 0; x < width; x++) edt1d(data, x, width, height, f, v, z);
    for (let y = 0; y < height; y++) edt1d(data, y * width, 1, width, f, v, z);
}

// 1D squared distance transform
function edt1d(grid, offset, stride, length, f, v, z) {
    let q, k, s, r;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;

    for (q = 0; q < length; q++) f[q] = grid[offset + q * stride];

    for (q = 1, k = 0, s = 0; q < length; q++) {
        do {
            r = v[k];
            s = (f[q] - f[r] + q * q - r * r) / (q - r) / 2;
        } while (s <= z[k] && --k > -1);

        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }

    for (q = 0, k = 0; q < length; q++) {
        while (z[k + 1] < q) k++;
        r = v[k];
        grid[offset + q * stride] = f[r] + (q - r) * (q - r);
    }
}
