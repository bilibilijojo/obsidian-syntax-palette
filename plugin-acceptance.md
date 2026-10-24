---
example: |
  ```python
  None = True
  ```
---

# Atom One 插件验收（v0.3.0）

> 背景开关关闭时，此样本应保持 Obsidian 原生代码块背景；开启时，所有围栏代码块（包括下方无语言/未知语言围栏）使用当前浅或深主题背景。行内代码、缩进代码、正文和围栏起止标记文字样式不变。

正文、**粗体**、*斜体*、[链接](https://example.com)、`行内代码 None True __name__` 应保持原样。

> 引用的颜色和布局保持原样。

## Python 截图复现

```python
import logging
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)

filter_xml = """
<interfaces xmlns="urn:example:interfaces"/>
"""

connection = manager.connect(
    **device,
    hostkey_verify = True
)

if connection is None:
    raise RuntimeError("NETCONF连接没有返回管理对象")

with connection:
    for i in connection.server_capabilities:
        print(i)

result = connection.get_config(
    source="running",
    filter=("subtree", filter_xml)
)

root = ET.fromstring(result.data_xml)
ns = {"if": "urn:example:interfaces"}
interfaces = root.findall(".//if:interface", ns)

for interface in interfaces:
    name = interface.find("if:name", ns)
    enabled = interface.find("if:enabled", ns)
    if name is None or enabled is None:
        logger.warning("接口数据缺少必要字段")
        continue
    if enabled.text == "false":
        logger.warning("%s 接口已禁用", name.text)
    elif enabled.text == "true":
        logger.info("%s 接口已启用", name.text)
    else:
        logger.warning("%s 接口状态字段异常", name.text)
```

## JavaScript

```javascript
// comment
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
{"name": "World", "count": 42, "enabled": true, "empty": null}
```

## Bash / Shell

```bash
#!/bin/bash
# comment
name="World"
if [ "$name" != "" ]; then
  echo "Hello $name"
  printf "%s\n" 42
fi
```

## HTML

```html
<!-- comment -->
<div class="card"><style>.card { color: red; }</style><a href="https://example.com">Hello</a></div>
```

## CSS

```css
/* comment */
.card, #main { color: red; padding: 12px; content: "Hello"; }
@media (width > 600px) { .card { display: flex; } }
```

## 不应影响的内容

```
None True __name__
```

```unknown-language
None True __name__
```

    None True __name__

%%
```python
commented = True
```
%%
