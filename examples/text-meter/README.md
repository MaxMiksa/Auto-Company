# Text Meter

Text Meter is a private, dependency-free browser tool for checking text as you write. It updates character count, non-whitespace character count, word count, and line count immediately in the browser.

## Run locally

Because the page uses JavaScript modules, serve this directory over loopback HTTP instead of opening `index.html` through a `file://` URL:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

On Windows, use `py` instead of `python3`. Then open <http://127.0.0.1:8000/>.

Type or paste text into the editor. The four counters update on every input.

- **Clear text** empties the editor and returns focus to it.
- **Use a sample** inserts a short example so the behavior is easy to inspect.
- No text is stored, transmitted, or saved by the product.

## Counting rules

Characters are counted as Unicode code points. Non-whitespace characters exclude JavaScript whitespace. Words are non-empty runs separated by whitespace, so text without spaces, including a Chinese phrase, counts as one word. Lines are separated by `LF`, `CRLF`, or `CR`; empty text has zero lines.

## Test

The product has no runtime or test dependencies. With a current Node.js release installed:

```sh
npm test
```

## License and asset source

This snapshot is covered by the repository's [MIT license](../../LICENSE). The geometric SVG is a program-generated fallback icon from Auto Company's product-media flow. No external image, font file, script, style, analytics service, or other remote asset is bundled. See [source history](SOURCE.md) for its requested-product origin.
