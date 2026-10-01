# 整餐引擎与内容范围

`catalog.js` 与 `engine.js` 是无依赖的浏览器 ES 模块；全部菜谱随产品提供，无需录入。六套整餐均包括主菜、蔬菜和米饭；四套原生素食，两套鸡肉提供完整素食替换。所有菜谱使用一名操作者、一口带盖炒锅与一台电饭煲。鸡肉菜单另需食品温度计。

## 接口

| 接口 | 输入与结果 |
| --- | --- |
| `menus` | 六套基础菜单数组；`id/title/description/vegetarian/minutes/dishes` 可用于选择器。基础时间以两份估算。 |
| `flavors` | `mild` 清淡、`chili` 香辣、`garlic` 蒜香，含 `id/label/name/description/ingredients`。 |
| `exclusions` | `soy/egg/mushroom/garlic/chili/tomato/chicken/chickpea`，含 `id/label/ingredientIds`。 |
| `findMenus({servingsA=1, servingsB=1, vegetarian=false, exclusions=[], maxMinutes=60, menuId?, flavorA?, flavorB?}={})` | 返回实际替换后的可行菜单数组，`title/dishes/vegetarian/minutes/substitutions` 对应当前设置；无可行结果返回空数组。可传完整表单配置；选传菜单标识只校验合法性、不限制候选，选传口味会校验与排除项冲突。`menuId: undefined` 表示尚未选择。 |
| `generatePlan({menuId, servingsA, servingsB, flavorA, flavorB, vegetarian=false, exclusions=[], maxMinutes=60})` | 返回完整整餐计划。不自动改选菜单或降低人数；不合法输入与不可行菜单抛中文 `Error`。 |
| `planToText(plan)` | 返回含分组、替换、采购清单、全部步骤及边界说明的纯文本。 |

份数每组必须为数字整数1–4，总数不超过6；时间上限为数字整数20–90；布尔值与数组必须使用其对应类型。不接受数字字符串、未知设置、未知标识或重复排除项。生成计划必须指定已存在的菜单与两组口味。

计划字段为 `id/menuId/title/servingsA/servingsB/totalServings/flavorA/flavorB/minutes/vegetarian/dishes/ingredients/steps/notes/substitutions/groups/config/equipment`。`dishes` 为字符串数组；`ingredients` 包含 `id/ingredientId/name/quantity/unit/group/note`，同一原料可因分组或用途出现多次，每行 `id` 独立唯一（如 `shared:rice`、`A:salt`、`B:salt`）且改变份数时稳定；`ingredientId` 为实际原料标识，排除检查以此为准。`group` 为「共享基础」「A组最后调味」「B组最后调味」。`steps` 包含 `id/title/detail/minutes/phase`，按顺序执行，`phase` 为 `prepare/cook/split/finish`。`groups` 为 `{id,label,servings,flavorId,flavorLabel}` 数组。`config` 保留规范化请求参数。

## 替换与排除

| 条件 | 实际更改 |
| --- | --- |
| 素食或排除鸡肉 | 鸡肉改为原味硬豆腐；肉类备料、测温等操作改为豆腐煎煮。 |
| 排除大豆或鸡蛋 | 豆腐或鸡蛋改为熟鹰嘴豆；清单、菜名与步骤一起改变。 |
| 排除番茄 | 番茄改为切小块南瓜，焖软；估时相应增加。 |
| 排除蘑菇 | 蘑菇改为西葫芦；清单与做法改变。 |
| 替换原料仍被排除 | 该菜单不可行，不悄悄移除主菜或回退其它菜单。 |
| 排除蒜 / 辣椒且选蒜香 / 香辣 | 生成计划报可读冲突错误，要求更换口味。 |

采购清单最终按实际食材 ID 检查排除项。没有未披露的酱油、蚝油或其它复合酱料；蒜香使用纯蒜粉，香辣使用纯辣椒粉，分盘后趁热拌入对应组主菜，米饭和蔬菜保持基础味。食材筛选不是过敏安全保证：必须另行核对包装配料和交叉接触标签，以及家中器具残留。

## 可执行性与未验证边界

每份干米75克、主菜蛋白原料150克豆腐/鸡肉或130克熟鹰嘴豆或2枚鸡蛋，搭配100–120克主菜蔬菜及160克配菜。所有用量按人数线性缩放，米饭水量仅为参考，按实际设备与米包装修正。所有重量为净重；熟豆必须已熟，不包含从干豆泡发与煮制。

超过两份时，主菜和蔬菜各以最多两份一批顺序炒制，提供每批用量比例，时间按主菜与蔬菜批次增加。电饭煲煮饭与备菜并行，其余步骤按一个人顺序执行。清淡组先盛，固体与汤汁均匀分配，每组独立干净碗勺；调味不回锅、不接触共享盆。

主菜水量为每份60毫升，每批的加水动作明确本批毫升数；各批相加等于采购清单中的主菜水量。`accent.usesMainWater` 标记蔬菜做法是否已经使用主菜水：为真时 `cook` 必须包含一次「分配给本批的主菜用水」，由引擎填入实际水量；为假时 `cook` 不含该动作，由蛋白流程统一补一次。新增或替换菜谱必须同时维护标记和步骤，不能按原料名称猜测是否已加水。玉米、土豆、南瓜、胡萝卜在蔬菜做法中加水；番茄、蘑菇及替换西葫芦由统一流程加水。网页和文字导出共用生成后的步骤。

鸡肉最后独立备料，不冲洗；处理后清洁手、刀板、台面与生食用具。每批用食品温度计确认最大肉块中心至少74°C，不以颜色或分钟数替代。依据：[USDA FSIS 鸡肉安全温度](https://ask.fsis.usda.gov/article/To-what-internal-temperature-should-I-cook-poultry)、[USDA FSIS 不冲洗禽肉](https://ask.fsis.usda.gov/article/Should-I-wash-chicken-or-other-poultry-before-cooking)、[USDA FSIS 清洁与分离](https://ask.fsis.usda.gov/article/How-do-I-keep-my-foods-safe-to-eat)（2026-10-01公开只读核对）。

菜谱内容与时间是本地软件提供的可操作计划，尚未经过真实烹饪、真人品尝或过敏环境验证。安全温度与熟度要求优先于估算时间，设备和实际操作可使时间延长。不声称营养治疗、真人需求验证、交易或盈利。
