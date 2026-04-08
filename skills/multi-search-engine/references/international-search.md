# International Search Guide

## Search Engines Overview

### Google
- URL: `https://www.google.com/search?q={keyword}`
- Features: Most comprehensive index, advanced operators
- Advanced: `site:`, `filetype:`, `intitle:`, `inurl:`, `related:`, `link:`

### Google Hong Kong
- URL: `https://www.google.com.hk/search?q={keyword}`
- Features: Google's Hong Kong domain, accessible in some regions
- Advanced: Same as Google

### DuckDuckGo
- URL: `https://duckduckgo.com/html/?q={keyword}`
- Features: Privacy-focused, no tracking, Bangs shortcuts
- Advanced: `site:`, `filetype:`, Bangs (`!g`, `!w`, `!yt`)

### Yahoo
- URL: `https://search.yahoo.com/search?p={keyword}`
- Features: Powered by Bing, news and finance focus
- Advanced: `site:`, `filetype:`

### Startpage
- URL: `https://www.startpage.com/sp/search?query={keyword}`
- Features: Google results with privacy protection
- Advanced: Similar to Google operators

### Brave Search
- URL: `https://search.brave.com/search?q={keyword}`
- Features: Independent index, privacy-focused
- Advanced: `site:`, `filetype:`

### Ecosia
- URL: `https://www.ecosia.org/search?q={keyword}`
- Features: Plant trees with searches, Bing-powered
- Advanced: Limited advanced operators

### Qwant
- URL: `https://www.qwant.com/?q={keyword}`
- Features: EU-based, GDPR compliant, privacy-focused
- Advanced: `site:`, `filetype:`

### WolframAlpha
- URL: `https://www.wolframalpha.com/input?i={keyword}`
- Features: Computational knowledge engine, not traditional search
- Advanced: Mathematical, scientific, and factual queries

## Advanced Search Operators

### Google-Specific Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `site:` | `site:github.com python` | Search within specific site |
| `filetype:` | `filetype:pdf tutorial` | Search for specific file type |
| `intitle:` | `intitle:"machine learning"` | Search in page title |
| `inurl:` | `inurl:blog python` | Search in URL |
| `related:` | `related:github.com` | Find related sites |
| `link:` | `link:openai.com` | Find pages linking to URL |
| `cache:` | `cache:example.com` | Show cached version |
| `info:` | `info:example.com` | Get information about URL |
| `define:` | `define:algorithm` | Get definition |
| `weather:` | `weather:Beijing` | Get weather |

### Time-Based Filters

Add these parameters to Google URLs:
- `&tbs=qdr:h` - Past hour
- `&tbs=qdr:d` - Past day  
- `&tbs=qdr:w` - Past week
- `&tbs=qdr:m` - Past month
- `&tbs=qdr:y` - Past year
- `&tbs=cdr:1,cd_min:1/1/2023,cd_max:12/31/2023` - Custom date range

### DuckDuckGo Bangs

| Bang | Destination | Example |
|------|-------------|---------|
| `!g` | Google | `!g python` |
| `!gh` | GitHub | `!gh tensorflow` |
| `!so` | Stack Overflow | `!so javascript error` |
| `!w` | Wikipedia | `!w AI` |
| `!yt` | YouTube | `!tutorial` |
| `!a` | Amazon | `!a laptop` |
| `!imdb` | IMDb | `!imdb movie` |
| `!tw` | Twitter | `!tw news` |
| `!r` | Reddit | `!r programming` |
| `!maps` | Google Maps | `!maps New York` |

## WolframAlpha Query Types

### Mathematics
- `integrate x^2 dx`
- `solve x^2 + 2x + 1 = 0`
- `plot sin(x)`
- `derivative of x^3`

### Conversions
- `100 USD to CNY`
- `10 miles to kilometers`
- `32 degrees Fahrenheit to Celsius`
- `1 gallon to liters`

### Science & Engineering
- `speed of light`
- `gravitational constant`
- `chemical formula of water`
- `atomic weight of carbon`

### Finance & Economics
- `AAPL stock`
- `GDP of China`
- `inflation rate USA`
- `exchange rate EUR USD`

### Geography & Weather
- `weather in Tokyo`
- `population of India`
- `area of Russia`
- `distance from Paris to London`

## Privacy Considerations

### Privacy-Focused Engines
1. **DuckDuckGo**: No tracking, no personalization
2. **Startpage**: Google results anonymously
3. **Brave**: Independent index, no tracking
4. **Qwant**: EU-based, GDPR compliant

### Privacy Tips
1. Use privacy engines for sensitive searches
2. Avoid logging into accounts while searching
3. Use VPN/Tor for additional anonymity
4. Clear cookies and cache regularly
5. Use private/incognito mode

## Performance Optimization

### Rate Limiting
- Most engines have rate limits (varies by engine)
- Add delays between requests (1-5 seconds)
- Rotate between engines for bulk searches
- Cache results when possible

### Handling CAPTCHA
- Some engines show CAPTCHA for automated requests
- Reduce request frequency
- Use human-like patterns (random delays)
- Consider using official APIs when available

### Error Handling
- Check for `429 Too Many Requests`
- Handle `503 Service Unavailable`
- Implement retry with exponential backoff
- Log errors for debugging

## Best Practices

1. **Respect ToS**: Read and follow each engine's Terms of Service
2. **User-Agent**: Use appropriate User-Agent headers
3. **Encoding**: Properly URL-encode all queries
4. **Localization**: Consider language and region settings
5. **Ethical Use**: Don't abuse or overload services