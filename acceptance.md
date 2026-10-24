# Atom One 代码高亮验收样本

正文、**粗体**、*斜体*、[链接](https://example.com) 与 `行内代码` 不应变化。

> 引用的颜色与布局不应变化。

## Python

```python
# 注释
class Greeter:
    def greet(self, name="World"):
        count = 42
        if count > 0:
            print(f"Hello {name}")
        return True
```

## JavaScript

```javascript
// 注释
class Greeter {
  greet(name = "World") {
    const count = 42;
    console.log(`Hello ${name}`);
    return count > 0 && true;
  }
}
```

## JSON

```json
{
  "name": "World",
  "count": 42,
  "enabled": true,
  "empty": null
}
```

## Bash / Shell

```bash
#!/bin/bash
# 注释
name="World"
if [ "$name" != "" ]; then
  echo "Hello $name"
  printf "%s\n" 42
fi
```

## HTML

```html
<!-- 注释 -->
<!DOCTYPE html>
<div class="card" id="main">
  <a href="https://example.com">Hello</a>
  <style>.card { color: red; }</style>
</div>
```

## CSS

```css
/* 注释 */
.card, #main {
  color: red;
  padding: 12px;
  content: "Hello";
  --accent: #4078f2;
}
@media (width > 600px) { .card { display: flex; } }
```

## 隔离检查

没有语言标记的围栏在阅读模式下保留原样：

```
plain text, 42, "string"
```

缩进代码块在阅读模式下保留原样：

    plain indented code

围栏内的布局、字体和背景应与启用前一致。编辑围栏起止行及语言标签时，它们的颜色也应与启用前一致。
