# Advanced Search Guide

## Domestic Search Engines

### Baidu (百度)
- URL: `https://www.baidu.com/s?wd={keyword}`
- Features: Chinese-focused, supports Baidu Baike, Baidu Tieba integration
- Advanced: `site:`, `filetype:`, `intitle:`, `inurl:`

### Bing CN (必应中国版)
- URL: `https://cn.bing.com/search?q={keyword}&ensearch=0`
- Features: Microsoft's search engine for China
- Advanced: `site:`, `filetype:`, `loc:`, `contains:`

### Bing International
- URL: `https://cn.bing.com/search?q={keyword}&ensearch=1`
- Features: International version accessible from China
- Advanced: Same as Bing CN

### 360 Search (360搜索)
- URL: `https://www.so.com/s?q={keyword}`
- Features: Qihoo 360's search engine
- Advanced: `site:`, `filetype:`

### Sogou (搜狗)
- URL: `https://sogou.com/web?query={keyword}`
- Features: Strong in Chinese web search
- Advanced: `site:`, `filetype:`

### WeChat Search (微信搜索)
- URL: `https://wx.sogou.com/weixin?type=2&query={keyword}`
- Features: Search within WeChat public accounts and articles
- Advanced: Limited advanced operators

### Toutiao Search (头条搜索)
- URL: `https://so.toutiao.com/search?keyword={keyword}`
- Features: ByteDance's search engine, strong in news and videos
- Advanced: Time filters, content type filters

### Jisilu (集思录)
- URL: `https://www.jisilu.cn/explore/?keyword={keyword}`
- Features: Chinese investment community search
- Advanced: Forum-specific search

## Search Tips for Chinese Engines

1. **Encoding**: Most modern Chinese search engines support UTF-8, but some older sites may expect GBK/GB2312
2. **Phrase Search**: Use quotes for exact matches: `"关键词"`
3. **Exclusion**: Use `-` to exclude terms: `苹果 -手机` (apple -phone)
4. **Site-specific**: Use `site:` to search within specific Chinese websites: `site:zhihu.com 编程`
5. **File type**: Use `filetype:` for specific document types: `filetype:pdf 报告`

## Common Use Cases

### Academic Research
```javascript
// Search for academic papers on Baidu
web_fetch({"url": "https://www.baidu.com/s?wd=filetype:pdf 机器学习 论文"})

// Search for research on Bing
web_fetch({"url": "https://cn.bing.com/search?q=site:cnki.net 人工智能&ensearch=0"})
```

### News Monitoring
```javascript
// Search for recent news on Toutiao
web_fetch({"url": "https://so.toutiao.com/search?keyword=科技新闻&sort=time"})

// Search WeChat articles
web_fetch({"url": "https://wx.sogou.com/weixin?type=2&query=疫情 最新"})
```

### Investment Research
```javascript
// Search investment discussions on Jisilu
web_fetch({"url": "https://www.jisilu.cn/explore/?keyword=ETF 投资"})

// Search financial news
web_fetch({"url": "https://www.so.com/s?q=股市 分析"})
```

## Performance Considerations

1. **Rate Limiting**: Chinese search engines may have stricter rate limits
2. **CAPTCHA**: Some engines may show CAPTCHA for frequent requests
3. **Mobile vs Desktop**: Some Chinese sites have different mobile/desktop interfaces
4. **Regional Restrictions**: Some content may be region-locked within China

## Best Practices

1. **Respect robots.txt**: Check each engine's robots.txt for crawling guidelines
2. **Use delays**: Add delays between requests to avoid being blocked
3. **Rotate engines**: Use different engines for similar queries to distribute load
4. **Cache results**: Cache frequently searched queries to reduce requests
5. **Handle encoding**: Ensure proper URL encoding for Chinese characters