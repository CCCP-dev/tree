# War Thunder Tech Tree

这是一个可离线浏览的《War Thunder》科技树静态站点。当前已经整理好陆军科技树数据，海军和空军入口仍保留为占位。

## 使用

- 直接打开 `index.html` 查看分支总览。
- 打开 `陆军.html` 查看陆军科技树。
- 打开 `载具.html?id=...` 查看单个载具详情。
- 射击判断器的唯一入口是 `shooting-judge.html`。

射击判断器所需的真实 hull/X-ray OBJ、参考图、索引和源页面副本位于 `real-xray-source/`；入口页面只引用项目内资源，可以直接使用 `file:///` 打开。

## 更新数据

源文件变更后，在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\convert-posf.ps1 -Source '..\未命名文件(2).posf' -Output '.\js\data.js'
```

## 说明

- 站点使用用户提供的 War Thunder Wiki 链接，不抓取 Wiki 内容。
- 如果需要发布到 GitHub Pages，把整个项目内容放到仓库根目录后开启 Pages 即可。
