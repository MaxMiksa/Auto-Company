const english = {
  '图检单': 'Image Checklist',
  '图检单首页': 'Image Checklist home',
  '浏览器本地处理': 'Processed in your browser',
  '无需上传': 'No uploads',
  '图片批次检查': 'Image batch review',
  '01 / 工作台': '01 / Workspace',
  '让每一张图，': 'Check every image,',
  '交付前': 'before ',
  '都过一遍。': 'you deliver.',
  '把图片拖进来，按你的标准核对尺寸、体积、格式和命名。问题集中列出，处理清单一键导出。': 'Drop in your images. Check dimensions, file size, format and names against your requirements, then export a list of issues.',
  '检查范围': 'Checks included',
  '项规则': 'rules',
  '张已检查': 'images checked',
  '结果导出': 'export',
  '图片 0042': 'Image 0042',
  '待校验': 'Awaiting review',
  '过一遍': 'delivery',
  '图片检查工作台': 'Image review workspace',
  '01 / 设定标准': '01 / Set requirements',
  '这批图，按什么要求检查？': 'What does this batch need to meet?',
  '以下为示例要求，请按本次交付约定修改': 'These are sample requirements. Set them for your delivery.',
  '尺寸': 'Dimensions',
  '最低像素': 'Minimum dimensions',
  '任一边不足即标记': 'Flag either side below the minimum',
  '宽度 ≥': 'Width ≥',
  '高度 ≥': 'Height ≥',
  '体积': 'File size',
  '文件上限': 'Maximum file size',
  '超过上限即标记': 'Flag files above the limit',
  '单张 ≤': 'Per image ≤',
  '允许的格式': 'Allowed formats',
  '格式': 'Format',
  '按文件内容识别，并检查扩展名': 'Identify the content and check its extension',
  '命名': 'Naming',
  '文件名规范': 'Filename rules',
  '同批重名会标记，忽略大小写': 'Flag duplicate names, ignoring case',
  '检查名称首尾空格': 'No leading or trailing spaces',
  '小写英文 / 数字 / - / _': 'Lowercase letters / digits / - / _',
  '只检查重名和前缀': 'Duplicates and prefix only',
  '指定前缀': 'Required prefix',
  '可选': 'optional',
  '例如 product-': 'e.g. product-',
  '02 / 导入文件': '02 / Add files',
  '把这批图片放进来': 'Bring in your image batch',
  '支持 PNG、JPEG、WebP、GIF、AVIF、BMP；其他文件会标记': 'PNG, JPEG, WebP, GIF, AVIF and BMP; other files are flagged',
  '选择图片文件，也可以拖入图片': 'Choose images or drop them here',
  '拖入图片，开始核对': 'Drop images here to check them',
  '文件只在此设备的浏览器中读取，不会传到服务器。': 'Files are read only in this browser. They are never uploaded.',
  '选择图片': 'Choose images',
  '选择文件夹': 'Choose folder',
  '检查结果': 'Check results',
  '03 / 查看结果': '03 / Review results',
  '检查记录': 'Review log',
  '0 张': '0 images',
  '全部': 'All',
  '待处理': 'Issues',
  '清空': 'Clear',
  '导出 CSV ↓': 'Export CSV ↓',
  '检查结果会出现在这里。': 'Your check results will appear here.',
  '先设好标准，再导入一批图片。': 'Set your requirements, then add a batch of images.',
  '为交付前的最后一眼': 'One final check before delivery',
  '本地读取 · 无账号 · 无上传': 'Local files · No account · No uploads',
  '文件名': 'Filename',
  '实际尺寸': 'Dimensions',
  '检查结论': 'Result',
  '无法读取': 'Unreadable',
  '未知': 'Unknown',
  '通过': 'Pass',
  '无法检查': 'Unable to check',
  '需处理': 'Needs attention',
  '这批图片没有待处理项。': 'This batch has no outstanding issues.',
  '无法识别图片格式': 'Unable to identify the image format',
  '扩展名与文件内容格式不一致': 'File extension does not match the content',
  '无法读取图片尺寸': 'Unable to read image dimensions',
  '文件名请使用小写英文、数字、- 或 _': 'Use lowercase letters, digits, - or _ in the filename',
  '文件名首尾有空格': 'Filename has leading or trailing spaces',
  '同批文件名重复，请核对后重命名': 'Duplicate filename in this batch; review and rename it',
  '宽(px)': 'Width (px)',
  '高(px)': 'Height (px)',
  '大小(bytes)': 'Size (bytes)',
  '状态': 'Status',
  '问题': 'Issues',
  '小写英文/数字/-/_': 'lowercase letters/digits/-/_',
  '名称首尾无空格': 'no leading or trailing spaces',
  '仅检查重名和前缀': 'duplicates and prefix only',
  '未设置': 'not set',
  '未选择': 'none selected',
  '无': 'none',
};

export function translate(text, language = 'zh-CN') {
  if (language !== 'en') return text;
  if (Object.hasOwn(english, text)) return english[text];
  let match;
  if ((match = text.match(/^(.+) 不在允许格式内$/))) return `${match[1]} is not an allowed format`;
  if ((match = text.match(/^(.+)；要求至少 (.+)$/))) return `${match[1]}; minimum ${match[2]}`;
  if ((match = text.match(/^(.+)；上限 (.+)$/))) return `${match[1]}; maximum ${match[2]}`;
  if ((match = text.match(/^文件名缺少前缀「(.*)」$/))) return `Filename is missing the prefix “${match[1]}”`;
  return text;
}

export function bindStaticTranslations(root = document.body) {
  const texts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const original = node.textContent;
    if (Object.hasOwn(english, original.trim())) texts.push({node, original});
  }
  const attributes = [];
  for (const node of root.querySelectorAll('[aria-label], [placeholder]')) {
    for (const name of ['aria-label', 'placeholder']) {
      const original = node.getAttribute(name);
      if (original && Object.hasOwn(english, original)) attributes.push({node, name, original});
    }
  }
  return language => {
    for (const {node, original} of texts) node.textContent = original.replace(original.trim(), translate(original.trim(), language));
    for (const {node, name, original} of attributes) node.setAttribute(name, translate(original, language));
    document.documentElement.lang = language;
    document.title = language === 'en' ? 'Image Checklist | Local image batch review' : '图检单｜本地图片批次检查';
    document.querySelector('meta[name="description"]').content = language === 'en'
      ? 'Check image dimensions, file size, format and filenames locally in your browser. Export a list of issues.'
      : '在浏览器本地核对图片尺寸、体积、格式与文件名，导出待处理清单。';
  };
}
