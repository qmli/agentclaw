---
name: multi-search-engine
description: Integration of 17 search engines for web crawling without API keys. Includes domestic (Baidu, Bing, 360, Sogou, WeChat, Toutiao, Jisilu) and international (Google, DuckDuckGo, Yahoo, Startpage, Brave, Ecosia, Qwant, WolframAlpha) search engines.
metadata: {"openclaw": {"requires": {"tools": ["web_fetch", "web_search"]}}}
---

# Multi Search Engine Skill

Integration of 17 search engines for web crawling without API keys.

## How to Use

### Step 1 — Search (always start here)

Call `web_search` with your query. This uses DuckDuckGo under the hood and is never blocked.

```
web_search(query="伊朗政治局势 2024")
web_search(query="Iran political situation today")
```

You will receive a numbered list of results with titles, URLs and snippets.

### Step 2 — Read specific articles (optional)

After getting search results, call `web_fetch` to read the full content of any promising URL.

```
web_fetch(url="https://www.bbc.com/news/world-middle-east-...")
```

**Important rules:**
- **Always use `web_search` first** — do NOT use `web_fetch` on search engine URLs (Google, Baidu etc. block server requests)
- If `web_fetch` returns a 403 error, skip that URL and try the next one from search results
- You may call `web_search` multiple times with different queries to get broader coverage
- **Do NOT output XML blocks or pseudo-code** — call tools directly and immediately

## Search Engines

### Domestic (8)

- Baidu: https://www.baidu.com/s?wd={keyword}
- Bing CN: https://cn.bing.com/search?q={keyword}&ensearch=0
- Bing INT: https://cn.bing.com/search?q={keyword}&ensearch=1
- 360: https://www.so.com/s?q={keyword}
- Sogou: https://sogou.com/web?query={keyword}
- WeChat: https://wx.sogou.com/weixin?type=2&query={keyword}
- Toutiao: https://so.toutiao.com/search?keyword={keyword}
- Jisilu: https://www.jisilu.cn/explore/?keyword={keyword}

### International (9)

- Google: https://www.google.com/search?q={keyword}
- Google HK: https://www.google.com.hk/search?q={keyword}
- DuckDuckGo: https://duckduckgo.com/html/?q={keyword}
- Yahoo: https://search.yahoo.com/search?p={keyword}
- Startpage: https://www.startpage.com/sp/search?query={keyword}
- Brave: https://search.brave.com/search?q={keyword}
- Ecosia: https://www.ecosia.org/search?q={keyword}
- Qwant: https://www.qwant.com/?q={keyword}
- WolframAlpha: https://www.wolframalpha.com/input?i={keyword}

## Quick Examples

```
# Basic search (call the tool directly)
web_fetch(url="https://www.google.com/search?q=python+tutorial")

# Time-filtered (past day)
web_fetch(url="https://www.google.com/search?q=ai+news&tbs=qdr:d")

# DuckDuckGo privacy search
web_fetch(url="https://duckduckgo.com/html/?q=privacy+tools")

# Baidu Chinese search
web_fetch(url="https://www.baidu.com/s?wd=%E4%BB%8A%E6%97%A5%E6%96%B0%E9%97%BB")

# WolframAlpha calculation
web_fetch(url="https://www.wolframalpha.com/input?i=100+USD+to+CNY")
```

## Advanced Operators

| Operator  | Example                | Description        |
| --------- | ---------------------- | ------------------ |
| site:     | site:github.com python | Search within site |
| filetype: | filetype:pdf report    | Specific file type |
| ""        | "machine learning"     | Exact match        |
| -         | python -snake          | Exclude term       |
| OR        | cat OR dog             | Either term        |

## Time Filters

| Parameter | Description |
| --------- | ----------- |
| tbs=qdr:h | Past hour   |
| tbs=qdr:d | Past day    |
| tbs=qdr:w | Past week   |
| tbs=qdr:m | Past month  |
| tbs=qdr:y | Past year   |

## Privacy Engines

- DuckDuckGo: No tracking
- Startpage: Google results + privacy
- Brave: Independent index
- Qwant: EU GDPR compliant

## Bangs Shortcuts (DuckDuckGo)

| Bang | Destination    |
| ---- | -------------- |
| !g   | Google         |
| !gh  | GitHub         |
| !so  | Stack Overflow |
| !w   | Wikipedia      |
| !yt  | YouTube        |

## WolframAlpha Queries

- Math: integrate x^2 dx
- Conversion: 100 USD to CNY
- Stocks: AAPL stock
- Weather: weather in Beijing

## URL Encoding Note

Always URL-encode the keyword before substituting into `{keyword}`.
For Chinese queries: UTF-8 percent-encoding works for all engines listed above.
