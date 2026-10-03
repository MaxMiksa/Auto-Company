import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { NativeSelect } from "./components/ui/native-select";
import { Checkbox } from "./components/ui/checkbox";
import { Switch } from "./components/ui/switch";
import { RadioGroup, RadioGroupItem } from "./components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Skeleton } from "./components/ui/skeleton";
import { Toaster } from "./components/ui/sonner";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "./components/ui/command";
import { AlertDescription } from "./components/ui/alert";
import { toast } from "sonner";

export const primitives: Record<string, React.ElementType> = {
  button: Button, input: Input, textarea: Textarea, select: NativeSelect,
  table: Table, thead: TableHeader, tbody: TableBody, tr: TableRow, th: TableHead, td: TableCell,
};
export function buttonProps(className = "") {
  return { variant: /\bprimary\b/.test(className) ? "default" : /\bdanger\b/.test(className) ? "destructive"
    : className.split(/\s+/).some(name => ["secondary", "button", "filter-button"].includes(name)) ? "outline" : "ghost",
  size: /icon-button|more-button|count-step|info-toggle/.test(className) ? "icon" : "default" } as const;
}

// Stateless primitives render through the official React component, including
// its wrapper/SVG. Controllers own their native events and uncontrolled values.
const wrappers = new WeakMap<HTMLElement, HTMLElement>();
export function element(tag: string, className = "", text?: string): HTMLElement {
  if (tag === "details") {
    const node = document.createElement("div"); node.dataset.disclosure = ""; node.className = className; return node;
  }
  if (tag === "summary") { tag = "button"; className += " disclosure-trigger"; }
  const Component = tag === "span" && className.split(/\s+/).includes("count-badge") ? Badge : primitives[tag];
  if (!Component) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(React.createElement(Component, {
    className: tag === "select" && className.split(/\s+/).includes("column-select") ? `${className} border-0 shadow-none font-medium` : className,
    ...(tag === "button" ? { ...buttonProps(className), type: "button" } : {}),
    ...(tag === "textarea" ? { defaultValue: text } : {}),
  }, ...(["input", "textarea"].includes(tag) ? [] : [text])));
  const outer = template.content.firstElementChild as HTMLElement;
  const node = (outer.matches(tag) ? outer : outer.querySelector(tag)) as HTMLElement;
  if (node !== outer) wrappers.set(node, outer);
  return node;
}

type Island = { root: Root; host: HTMLElement; attached: boolean; dispose?: () => void };
const islands = new Set<Island>();
function island(host: HTMLElement, render: () => React.ReactNode, dispose?: () => void) {
  const root = createRoot(host);
  const entry = { host, root, attached: host.isConnected, dispose }; islands.add(entry);
  const update = () => flushSync(() => root.render(render()));
  update(); return update;
}
function sweep() {
  for (const entry of islands) {
    if (entry.host.isConnected) entry.attached = true;
    else if (entry.attached) { entry.root.unmount(); entry.dispose?.(); islands.delete(entry); }
  }
}
function slot(nodes: Node[]) { return (node: HTMLElement | null) => { if (node) nodes.forEach(child => node.append(child)); }; }

// Hidden native fields remain the form/controller contract, not an interactive
// second control. Radix owns focus/keyboard; property writes and reset update it.
function connectField(input: HTMLInputElement, update: () => void) {
  const cleanups: (() => void)[] = [];
  for (const property of ["checked", "disabled"] as const) {
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, property)!;
    Object.defineProperty(input, property, { configurable: true, get: () => native.get!.call(input), set: value => { native.set!.call(input, value); update(); } });
    cleanups.push(() => { delete (input as unknown as Record<string, unknown>)[property]; });
  }
  input.hidden = true; input.tabIndex = -1; input.setAttribute("aria-hidden", "true"); input.dataset.uiField = "";
  const reset = () => queueMicrotask(update);
  input.form?.addEventListener("reset", reset);
  const form = input.form;
  return () => { cleanups.forEach(clean => clean()); form?.removeEventListener("reset", reset); };
}
function setChecked(input: HTMLInputElement, checked: boolean) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")!.set!.call(input, checked);
}
function installCheckbox(input: HTMLInputElement) {
  const host = document.createElement("span"); host.className = "choice-control"; input.before(host);
  const isSwitch = ["autoRefresh", "centerAutoRefresh", "followLog"].includes(input.id);
  const Component = isSwitch ? Switch : Checkbox;
  const controlId = input.id ? `${input.id}-control` : `choice-${++serial}`;
  const label = input.closest("label"); if (label) label.htmlFor = controlId;
  let dispose: (() => void) | undefined;
  const update = island(host, () => <Component id={controlId} checked={input.checked} disabled={input.disabled}
    aria-label={label?.textContent?.trim()} onCheckedChange={value => {
      setChecked(input, value === true); update(); input.dispatchEvent(new Event("change", { bubbles: true }));
    }} />, () => dispose?.());
  dispose = connectField(input, update);
  input.focus = options => host.querySelector("button")?.focus(options);
}
let serial = 0;
function installRadios(inputs: HTMLInputElement[]) {
  const labels = inputs.map(input => input.closest("label")!);
  if (labels.some(label => !label)) return;
  const host = document.createElement("div"); host.className = "radio-group-host"; labels[0].before(host);
  const contents = labels.map((label, index) => [...label.childNodes].filter(node => node !== inputs[index]));
  const refs = contents.map(slot);
  const nativeRefs = inputs.map(input => slot([input]));
  const labelClasses = labels.map(label => label.className);
  labels.forEach(label => label.remove());
  const groupId = `radio-${++serial}`;
  const cleanups: (() => void)[] = [];
  const update = island(host, () => <RadioGroup value={inputs.find(input => input.checked)?.value || ""}
    aria-label={host.closest("fieldset")?.querySelector("legend")?.textContent || inputs[0].name}
    onValueChange={value => {
      inputs.forEach(input => setChecked(input, input.value === value)); update();
      inputs.find(input => input.value === value)?.dispatchEvent(new Event("change", { bubbles: true }));
    }}>
    {inputs.map((input, index) => <label key={index} className={labelClasses[index]} htmlFor={`${groupId}-${index}`}>
      <RadioGroupItem id={`${groupId}-${index}`} value={input.value} disabled={input.disabled} />
      <span ref={refs[index]} className="choice-copy" /><span hidden ref={nativeRefs[index]} />
    </label>)}
  </RadioGroup>, () => cleanups.forEach(clean => clean()));
  inputs.forEach(input => cleanups.push(connectField(input, update)));
}

function installDisclosure(container: HTMLElement) {
  const trigger = container.querySelector<HTMLElement>(":scope > summary, :scope > .disclosure-trigger");
  if (!trigger) return;
  let open = Boolean((container as HTMLElement & { open?: boolean }).open);
  const triggerProps = { className: `${trigger.className} disclosure-trigger`, id: trigger.id || undefined,
    "data-focus-key": trigger.dataset.focusKey, "data-i18n": trigger.dataset.i18n,
    "aria-label": trigger.getAttribute("aria-label") || undefined, "data-i18n-aria": trigger.dataset.i18nAria };
  const triggerRef = slot([...trigger.childNodes].map(node => node.cloneNode(true)));
  const contentNodes = [...container.childNodes].filter(node => node !== trigger);
  const contentRef = slot(contentNodes);
  container.replaceChildren(); container.dataset.uiDisclosure = "";
  const change = (value: boolean) => {
    open = value; container.toggleAttribute("open", open); update(); container.dispatchEvent(new Event("toggle"));
  };
  const update = island(container, () => <Collapsible open={open} onOpenChange={change}>
    <CollapsibleTrigger asChild><Button {...triggerProps} type="button" variant="ghost" ref={triggerRef} /></CollapsibleTrigger>
    <CollapsibleContent forceMount hidden={!open} ref={contentRef} />
  </Collapsible>);
  Object.defineProperty(container, "open", { configurable: true, get: () => open, set: change });
  container.toggleAttribute("open", open);
}

// The controller calls this at its render boundary, before restoring focus.
// There is no document-wide observer or competing business state store.
export function mountControls(scope: ParentNode = document) {
  sweep();
  scope.querySelectorAll<HTMLElement>("select,table").forEach(node => {
    const wrapper = wrappers.get(node);
    if (wrapper && node.parentElement !== wrapper) { node.before(wrapper); wrapper.prepend(node); }
  });
  scope.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not([data-ui-field]):not([aria-hidden=true])').forEach(installCheckbox);
  const radios = [...scope.querySelectorAll<HTMLInputElement>('input[type=radio]:not([data-ui-field]):not([aria-hidden=true])')];
  while (radios.length) {
    const first = radios[0];
    const group = radios.filter(input => input.name === first.name && input.closest("fieldset") === first.closest("fieldset"));
    installRadios(group); group.forEach(input => radios.splice(radios.indexOf(input), 1));
  }
  scope.querySelectorAll<HTMLElement>("[data-disclosure]:not([data-ui-disclosure])").forEach(installDisclosure);
}

export function notifications() {
  const host = document.createElement("div"); document.body.append(host);
  createRoot(host).render(<Toaster position="bottom-right" duration={4000} />);
}
export function notify(message: string) { toast.success(message); }
export function alertMessage(message: string) {
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(<AlertDescription>{message}</AlertDescription>);
  return template.content.firstElementChild as HTMLElement;
}
export function loading(container: HTMLElement, message: string) {
  container.replaceChildren(element("span", "", message));
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(<Skeleton className="h-8 w-full" />);
  container.append(template.content);
}
export function Hint({ label, children }: { label: string; children: React.ReactElement }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>;
}

type GroupOption = { id: string; title: string; detail: string };
const groupRoots = new WeakMap<HTMLElement, Root>();
function GroupTabs({ options, value, onChange }: { options: GroupOption[]; value: string; onChange: (id: string) => void }) {
  const [narrow, setNarrow] = React.useState(matchMedia("(max-width: 650px)").matches);
  React.useEffect(() => {
    const query = matchMedia("(max-width: 650px)"); const change = () => setNarrow(query.matches);
    query.addEventListener("change", change); return () => query.removeEventListener("change", change);
  }, []);
  return <Tabs orientation={narrow ? "horizontal" : "vertical"} value={value} onValueChange={onChange}>
    <TabsList variant="line" aria-label={document.documentElement.lang === "zh-CN" ? "配置组" : "Configuration groups"}>
      {options.map(option => <TabsTrigger key={option.id} value={option.id} id={`${option.id}-tab`} aria-controls={option.id} className="work-group-tab">
        <span><strong>{option.title}</strong><small>{option.detail}</small></span>
      </TabsTrigger>)}
    </TabsList>
  </Tabs>;
}
export function groupTabs(container: HTMLElement, options: GroupOption[], value: string, onChange: (id: string) => void) {
  let root = groupRoots.get(container);
  if (!root) { container.removeAttribute("role"); root = createRoot(container); groupRoots.set(container, root); }
  flushSync(() => root.render(<GroupTabs options={options} value={value} onChange={onChange} />));
}

type ProductOption = { entryId: string; displayName: string; description?: string; alias?: string };
type ProductLabels = { search: string; empty: string; current: string };
let switcherRoot: Root | undefined;
let switcherSession = 0;
export function productSwitcher(entries: ProductOption[], current: string, labels: ProductLabels, reset = false) {
  const host = document.getElementById("productSwitcherControls"); if (!host) return;
  switcherRoot ||= createRoot(host); if (reset) switcherSession += 1;
  flushSync(() => switcherRoot!.render(<Command key={switcherSession} label={labels.search} loop filter={(_value, search, keywords) => {
    const query = search.trim().toLocaleLowerCase(document.documentElement.lang);
    return (keywords || []).some(value => value.toLocaleLowerCase(document.documentElement.lang).includes(query)) ? 1 : 0;
  }}>
    <CommandInput placeholder={labels.search} aria-label={labels.search} />
    <CommandList aria-label={labels.search}>
      <CommandEmpty>{labels.empty}</CommandEmpty>
      {entries.map(entry => <CommandItem key={entry.entryId} value={entry.entryId} keywords={[entry.displayName, entry.description || "", entry.alias || ""]}
        onSelect={() => { window.location.href = `/products/${encodeURIComponent(entry.entryId)}`; }}>
        <span className="product-option-copy"><strong>{entry.displayName}</strong><small>{entry.description}</small></span>
        {entry.entryId === current && <span className="switcher-current">{labels.current}</span>}
      </CommandItem>)}
    </CommandList>
  </Command>));
}
