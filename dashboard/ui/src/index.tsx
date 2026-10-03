import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent } from "./components/ui/dialog";
import { AlertDialog, AlertDialogContent } from "./components/ui/alert-dialog";
import { Sheet, SheetContent } from "./components/ui/sheet";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { cn } from "./lib/utils";
import { element, mountControls, primitives, buttonProps, notifications, notify, loading, groupTabs, Hint, productSwitcher, alertMessage } from "./controls";
import { Skeleton } from "./components/ui/skeleton";
import { Alert } from "./components/ui/alert";
import { ChevronDown, EllipsisVertical, Settings } from "lucide-react";

type ModalElement = HTMLElement & { showModal: () => void; close: () => void; open: boolean };
type MenuItem = { label: string; disabled?: boolean; reason?: string; danger?: boolean; action: () => void; focusKey?: string };
type MenuProps = { id: string; label: string; items: MenuItem[] };
const menus = new Map<string, { host: HTMLSpanElement; root: Root }>();

// The controllers own records and form values. The shared UI owns modal/menu
// interaction; a stable DOM slot preserves those records when a portal opens.
function installModal(original: HTMLElement, sheet = false) {
  const id = original.id;
  const titleId = original.getAttribute("aria-labelledby") || undefined;
  const confirmation = id === "confirmDialog" || original.dataset.confirmation === "true";
  const host = document.createElement("span");
  host.dataset.uiRoot = sheet ? "sheet" : "dialog";
  document.body.append(host);
  const root = createRoot(host);
  let open = false;
  let returnFocus: HTMLElement | null = null;
  let content: HTMLDivElement | null = null;
  original.dataset.dialogId = id;
  if (sheet) original.hidden = true;
  const change = (next: boolean) => {
    if (next === open) return;
    if (next) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    open = next;
    flushSync(render);
    if (!next) original.dispatchEvent(new Event("close"));
  };
  const attach = (node: HTMLDivElement | null) => {
    if (node) {
      original.id = `${id}-parking`;
      node.id = id;
      while (original.firstChild) node.append(original.firstChild);
      content = node;
      bind(node);
    } else if (content) {
      while (content.firstChild) original.append(content.firstChild);
      original.id = id;
      content = null;
    }
  };
  const bind = (node: HTMLElement) => {
    Object.defineProperty(node, "open", { configurable: true, get: () => open });
    (node as ModalElement).showModal = () => change(true);
    (node as ModalElement).close = () => change(false);
  };
  function render() {
    const common = {
      className: cn("ac-overlay-content", sheet ? "ac-sheet" : "ac-dialog", original.className),
      "data-dialog-id": id,
      "aria-labelledby": titleId,
      "aria-describedby": undefined,
      showCloseButton: false,
      onInteractOutside: (event: CustomEvent<{ originalEvent: Event }>) => {
        // Shell controls retain their DOM identity when moved into this portal.
        // Test containment against DOM, not their original React ancestry.
        const target = event.detail.originalEvent.target as Node;
        if (!target.isConnected || content?.contains(target)) event.preventDefault();
      },
      onOpenAutoFocus: (event: Event) => {
        event.preventDefault();
        const heading = titleId ? document.getElementById(titleId) : null;
        const target = confirmation ? content?.querySelector<HTMLElement>('[data-safe-action], .dialog-close, button:not(.danger):not(:disabled)')
          : id === "newWorkDialog" ? heading
          : content?.querySelector<HTMLElement>(sheet ? "button:not(:disabled)" : "input:not([type=radio]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)");
        if (target === heading && heading) heading.tabIndex = -1;
        (target || content)?.focus();
      },
      onCloseAutoFocus: (event: Event) => {
        event.preventDefault();
        const replacement = returnFocus?.dataset.focusKey ? [...document.querySelectorAll<HTMLElement>("[data-focus-key]")].find(node => node.dataset.focusKey === returnFocus?.dataset.focusKey) : null;
        const target = returnFocus?.isConnected ? returnFocus : replacement || document.querySelector<HTMLElement>("#catalogHeading, #mainContent");
        if (target) { if (!target.matches("button,a,input,select,textarea,[tabindex]")) target.tabIndex = -1; target.focus({ preventScroll: true }); }
      },
    };
    const { showCloseButton, onInteractOutside, ...alertProps } = common;
    const slot = <div ref={attach} className="ac-owned-content" data-dialog-id={id} data-confirmation={confirmation || undefined} />;
    root.render(sheet
      ? <Sheet open={open} onOpenChange={change}><SheetContent {...common}>{slot}</SheetContent></Sheet>
      : confirmation ? <AlertDialog open={open} onOpenChange={change}><AlertDialogContent {...alertProps} aria-describedby={original.getAttribute("aria-describedby") || "confirmMessage"}>{slot}</AlertDialogContent></AlertDialog>
      : <Dialog open={open} onOpenChange={change}><DialogContent {...common}>{slot}</DialogContent></Dialog>);
  }
  bind(original);
  flushSync(render);
}

function ProductMenu({ id, label, items }: MenuProps) {
  const trigger = React.useRef<HTMLButtonElement>(null);
  return <DropdownMenu>
    <Hint label={label}><DropdownMenuTrigger asChild>
      <Button ref={trigger} variant="ghost" size="icon-sm" className="more-button" aria-label={label} data-focus-key={`entry:${id}:more`}><EllipsisVertical aria-hidden="true" /></Button>
    </DropdownMenuTrigger></Hint>
    <DropdownMenuContent className="ac-menu" align="end" sideOffset={4}>
      {items.map((item, index) => <React.Fragment key={index}>{item.danger && !items[index - 1]?.danger && <DropdownMenuSeparator />}<DropdownMenuItem disabled={item.disabled} title={item.reason}
        data-focus-key={item.focusKey} className={item.danger ? "ac-danger" : ""}
        onSelect={() => { setTimeout(() => { trigger.current?.focus({ preventScroll: true }); item.action(); }, 0); }}>
        <span>{item.label}{item.disabled && item.reason && <small className="ac-menu-reason">{item.reason}</small>}</span>
      </DropdownMenuItem></React.Fragment>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function menu(props: MenuProps) {
  let entry = menus.get(props.id);
  if (!entry) {
    const host = document.createElement("span");
    host.className = "action-menu";
    entry = { host, root: createRoot(host) };
    menus.set(props.id, entry);
  }
  flushSync(() => entry.root.render(<ProductMenu {...props} />));
  return entry.host;
}
function retainMenus(ids: string[]) {
  const retained = new Set(ids);
  for (const [id, entry] of menus) if (!retained.has(id)) {
    entry.root.unmount();
    menus.delete(id);
  }
}

let updateFilter: ((value: string) => void) | undefined;
function selectFilter(value: string) { updateFilter?.(value); }
function CatalogFilters({ node }: { node: Element }) {
  const [value, setValue] = React.useState("all");
  updateFilter = next => { if (next !== value) flushSync(() => setValue(next)); };
  return <ToggleGroup id="filters" className="filters" type="single" value={value}
    aria-label={node.getAttribute("aria-label") || undefined} data-i18n-aria="filterProducts"
    onValueChange={next => { if (next) setValue(next); }}>
    {[...node.children].map(button => <ToggleGroupItem key={button.getAttribute("data-filter")!}
      value={button.getAttribute("data-filter")!} data-filter={button.getAttribute("data-filter")}
      className="filter-button">
      <span data-i18n={button.firstElementChild?.getAttribute("data-i18n") || undefined}>{button.textContent}</span>
    </ToggleGroupItem>)}
  </ToggleGroup>;
}

function ProfileMenu() {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const chinese = document.documentElement.lang === "zh-CN";
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <Button ref={trigger} id="profileButton" variant="ghost" size="sm" className="profile-button" aria-label={chinese ? "本机" : "Local"} data-i18n-aria="localWorkspace">
        <span className="profile-avatar" aria-hidden="true" data-i18n="localInitial">{chinese ? "本" : "L"}</span>
        <span data-i18n="localWorkspace">{chinese ? "本机" : "Local"}</span>
        <ChevronDown className="profile-chevron" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="ac-menu" align="end" sideOffset={4}>
      <DropdownMenuItem onSelect={() => setTimeout(() => {
        trigger.current?.focus({ preventScroll: true });
        document.getElementById("settingsButton")?.click();
      }, 0)}><Settings aria-hidden="true" />{chinese ? "设置" : "Settings"}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

// Render the authored shell once with real shadcn primitives. Record containers
// and uncontrolled form values are then owned by the existing controllers. Never
// re-render this root: interactive islands below have separate, bounded roots.
function mountShell() {
  const propNames: Record<string, string> = { class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", autocomplete: "autoComplete", spellcheck: "spellCheck", autofocus: "autoFocus", maxlength: "maxLength", rowspan: "rowSpan", colspan: "colSpan", "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap", "stroke-linejoin": "strokeLinejoin", viewbox: "viewBox" };
  const booleanProps = new Set(["hidden", "disabled", "required", "multiple", "readOnly", "autoFocus", "open"]);
  function convert(node: Node, key: number): React.ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const tag = node.tagName.toLowerCase();
    if (tag === "script") return null;
    if (node.id === "profileButton") return <ProfileMenu key={key} />;
    if (node.id === "filters") return <CatalogFilters key={key} node={node} />;
    const props: Record<string, unknown> = { key };
    for (const attr of node.attributes) {
      const name = propNames[attr.name] || attr.name;
      if (name.startsWith("on")) continue;
      if (name === "style") {
        const style = (node as HTMLElement).style;
        props.style = Object.fromEntries([...style].map(property => [property.startsWith("--") ? property : property.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()), style.getPropertyValue(property)]));
      } else if (name === "checked") props.defaultChecked = true;
      else if (name === "selected") continue;
      else if (name === "value" && tag === "input") props.defaultValue = attr.value;
      else props[name] = booleanProps.has(name) ? true : attr.value;
    }
    let component: React.ElementType = primitives[tag] || tag as React.ElementType;
    if (tag === "button") Object.assign(props, buttonProps(node.className));
    else if (tag === "textarea") props.defaultValue = node.textContent;
    else if (tag === "select") props.defaultValue = (node as HTMLSelectElement).value;
    else if (tag === "input" && ["checkbox", "radio"].includes(node.getAttribute("type") || "")) component = "input";
    else if (tag === "details") { component = "div"; props["data-disclosure"] = ""; }
    else if (tag === "summary") { component = Button; props.variant = "ghost"; props.type = "button"; props.className = `${props.className || ""} disclosure-trigger`; }
    else if (["actionError", "connectionNotice", "connectionError", "actionStatus", "errorState"].includes(node.id)) { component = Alert; if (node.getAttribute("role") === "alert") props.variant = "destructive"; }
    const children = [...node.childNodes].map(convert);
    if (node.id === "loadingState") return <div {...props}>{children}<Skeleton className="h-8 w-full" /></div>;
    const control = React.createElement(component, props, ...(["input", "textarea", "img", "hr", "br", "link", "meta"].includes(tag) ? [] : children));
    return tag === "button" && node.hasAttribute("title") && node.hasAttribute("aria-label") ? <Hint key={key} label={node.getAttribute("aria-label")!}>{control}</Hint> : control;
  }
  const content = [...document.body.childNodes].map(convert);
  const shell = createRoot(document.body);
  flushSync(() => shell.render(<>{content}</>));
}

let updateTab: ((value: string) => void) | undefined;
function installTabs() {
  const container = document.querySelector<HTMLElement>("nav.tabs");
  if (!container) return;
  const label = container.getAttribute("aria-label") || "";
  const options = [...container.querySelectorAll<HTMLElement>("[data-tab]")].map(node => ({
    value: node.dataset.tab!, id: node.id, label: node.textContent,
    key: node.dataset.i18n, panel: node.getAttribute("aria-controls") || undefined,
  }));
  container.removeAttribute("role");
  container.className = "ac-tabs-host";
  const root = createRoot(container);
  function JournalTabs() {
    const [value, setValue] = React.useState(options[0].value);
    updateTab = (next) => { if (next !== value) flushSync(() => setValue(next)); };
    return <Tabs className="ac-tabs" activationMode="manual" value={value} onValueChange={next => {
      document.dispatchEvent(new CustomEvent("ui-tab-change", { detail: next }));
    }}>
      <TabsList variant="line" className="tabs" aria-label={label}>
        {options.map(option => <TabsTrigger key={option.value} value={option.value} id={option.id}
          className="tab" data-tab={option.value} data-i18n={option.key} aria-controls={option.panel}>{option.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>;
  }
  flushSync(() => root.render(<JournalTabs />));
}
function selectTab(value: string) { updateTab?.(value); }

declare global {
  interface Window { DashboardUI: { element: typeof element; mountControls: typeof mountControls; notify: typeof notify; loading: typeof loading; groupTabs: typeof groupTabs; productSwitcher: typeof productSwitcher; alertMessage: typeof alertMessage; menu: typeof menu; retainMenus: typeof retainMenus; selectTab: typeof selectTab; selectFilter: typeof selectFilter } }
}
window.DashboardUI = { element, mountControls, notify, loading, groupTabs, productSwitcher, alertMessage, menu, retainMenus, selectTab, selectFilter };
mountShell();
installTabs();
mountControls();
notifications();
productSwitcher([], "", { search: "", empty: "", current: "" });
document.querySelectorAll<HTMLElement>("dialog").forEach(node => installModal(node));
const queue = document.getElementById("queueDrawer");
if (queue) installModal(queue, true);
document.documentElement.dataset.ui = "shadcn";
