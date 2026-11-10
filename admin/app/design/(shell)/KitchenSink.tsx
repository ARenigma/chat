'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { MagnifyingGlass, Plus, DotsThree, Trash } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, AsyncButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge, StatusBadge, type Tone } from '@/components/ui/badge';
import { StatusIcon } from '@/components/ui/status-icon';
import { Kbd } from '@/components/ui/kbd';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Panel } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Chart } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, List, ListGroup, ListRow, ListId } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuShortcut } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { barChartOption, donutChartOption, lineChartOption, scatterChartOption, sparklineOption } from '@/lib/chart/options';
import { PROVIDERS, SESSIONS_OVER_TIME, APPLICATIONS_BY_WEEK, PROVIDERS_BY_STATUS, SESSION_VS_EARNINGS, KPIS } from '../fixtures';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-md font-semibold tracking-[-0.01em] text-primary">{title}</h2>
      {children}
    </section>
  );
}

const TOKENS: { name: string; cls: string }[] = [
  { name: 'shell', cls: 'bg-shell' }, { name: 'surface', cls: 'bg-surface' }, { name: 'raised', cls: 'bg-raised' },
  { name: 'hover', cls: 'bg-hover' }, { name: 'selected', cls: 'bg-selected' }, { name: 'accent', cls: 'bg-accent' },
  { name: 'accent-subtle', cls: 'bg-accent-subtle' }, { name: 'success', cls: 'bg-success-dot' }, { name: 'warning', cls: 'bg-warning-dot' },
  { name: 'danger', cls: 'bg-danger-dot' }, { name: 'info', cls: 'bg-info-dot' }, { name: 'neutral', cls: 'bg-neutral-dot' },
  { name: 'chart-1', cls: 'bg-chart-1' }, { name: 'chart-2', cls: 'bg-chart-2' }, { name: 'chart-3', cls: 'bg-chart-3' }, { name: 'chart-4', cls: 'bg-chart-4' },
  { name: 'chart-5', cls: 'bg-chart-5' }, { name: 'chart-6', cls: 'bg-chart-6' }, { name: 'chart-7', cls: 'bg-chart-7' }, { name: 'chart-8', cls: 'bg-chart-8' },
];

export function KitchenSink() {
  const [pending, setPending] = React.useState(false);
  const small = React.useCallback((t: Parameters<typeof lineChartOption>[0]) => lineChartOption(t, SESSIONS_OVER_TIME), []);
  const bar = React.useCallback((t: Parameters<typeof barChartOption>[0]) => barChartOption(t, APPLICATIONS_BY_WEEK), []);
  const donut = React.useCallback((t: Parameters<typeof donutChartOption>[0]) => donutChartOption(t, { data: PROVIDERS_BY_STATUS }), []);
  const scatter = React.useCallback((t: Parameters<typeof scatterChartOption>[0]) => scatterChartOption(t, { series: [{ name: 'Providers', data: SESSION_VS_EARNINGS }] }), []);
  const spark = React.useCallback((t: Parameters<typeof sparklineOption>[0]) => sparklineOption(t, [3, 5, 4, 7, 6, 9, 8, 11]), []);
  const tones: Tone[] = ['success', 'warning', 'danger', 'info', 'neutral', 'accent'];

  return (
    <div className="flex max-w-[1000px] flex-col gap-10">
      <PageHeader title="Kitchen sink" description="Every component and state on the Linear-style foundation. Dev-only preview, fixture data." />

      <Section title="Tokens">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {TOKENS.map((t) => (
            <div key={t.name} className="flex items-center gap-2 rounded-sm border border-hairline bg-raised p-1.5 text-xs text-secondary">
              <span className={`size-5 shrink-0 rounded-xs border border-hairline-strong ${t.cls}`} />
              {t.name}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-primary">text-primary</span><span className="text-body">text-body</span>
          <span className="text-secondary">text-secondary</span><span className="text-tertiary">text-tertiary</span>
          <span className="text-accent-fg">text-accent-fg</span>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
          <AsyncButton pending={pending} onClick={() => { setPending(true); setTimeout(() => setPending(false), 1500); }}>Async</AsyncButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg">Large</Button><Button>Default</Button><Button size="sm">Small</Button><Button size="xs">XS</Button>
          <Button size="icon" variant="secondary" aria-label="Add"><Plus /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="More"><DotsThree weight="bold" /></Button>
          <Button size="sm"><Plus /> With icon</Button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="k-name">Name</Label><Input id="k-name" placeholder="Placeholder" /></div>
          <div className="grid gap-1.5"><Label htmlFor="k-dis">Disabled</Label><Input id="k-dis" disabled defaultValue="Disabled" /></div>
          <div className="grid gap-1.5"><Label htmlFor="k-inv">Invalid</Label><Input id="k-inv" aria-invalid defaultValue="oops" /></div>
          <div className="grid gap-1.5">
            <Label htmlFor="k-sel">Select</Label>
            <Select defaultValue="weekly">
              <SelectTrigger id="k-sel" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="k-ta">Textarea</Label><Textarea id="k-ta" placeholder="Write a note…" /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox defaultChecked /> Checked</label>
          <label className="flex items-center gap-2 text-sm"><Switch defaultChecked /> Switch on</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox /> Unchecked</label>
          <label className="flex items-center gap-2 text-sm"><Switch /> Switch off</label>
        </div>
      </Section>

      <Section title="Badges, status, kbd">
        <div className="flex flex-wrap items-center gap-2">
          {['active', 'under_review', 'needs_info', 'approved', 'rejected', 'scheduled', 'draft', 'superseded'].map((s) => <StatusBadge key={s} status={s} />)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tones.map((t) => <Badge key={t} dot={t}>{t}</Badge>)}
          <Badge variant="secondary">Secondary</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusIcon state="backlog" /> Backlog <StatusIcon state="todo" /> Todo
          <StatusIcon state="progress" tone="warning" /> In progress <StatusIcon state="done" tone="info" /> Done
          <StatusIcon state="canceled" /> Canceled
          <span className="ml-4 inline-flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="a">
          <TabsList><TabsTrigger value="a">Overview</TabsTrigger><TabsTrigger value="b">Activity</TabsTrigger><TabsTrigger value="c">Settings</TabsTrigger></TabsList>
          <TabsContent value="a" className="text-sm text-secondary">Overview content.</TabsContent>
          <TabsContent value="b" className="text-sm text-secondary">Activity content.</TabsContent>
          <TabsContent value="c" className="text-sm text-secondary">Settings content.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="secondary">Menu <DotsThree weight="bold" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem><MagnifyingGlass /> Inspect <DropdownMenuShortcut>I</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-variant="destructive"><Trash /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog>
            <DialogTrigger asChild><Button variant="secondary">Dialog</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Publish config</DialogTitle><DialogDescription>This makes version 13 live for every provider.</DialogDescription></DialogHeader>
              <DialogFooter><DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose><Button>Publish</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="danger">Alert dialog</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Reject application?</AlertDialogTitle><AlertDialogDescription>The applicant is notified. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="danger">Reject</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Sheet>
            <SheetTrigger asChild><Button variant="secondary">Sheet</Button></SheetTrigger>
            <SheetContent><SheetHeader><SheetTitle>Provider</SheetTitle><SheetDescription>Side panel content.</SheetDescription></SheetHeader></SheetContent>
          </Sheet>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Info"><DotsThree weight="bold" /></Button></TooltipTrigger><TooltipContent>Tooltip text</TooltipContent></Tooltip>
          <Button variant="secondary" onClick={() => toast.success('Saved', { description: 'Draft v13 stored' })}>Toast success</Button>
          <Button variant="secondary" onClick={() => toast.error('Could not publish')}>Toast error</Button>
          <span className="text-xs text-tertiary">Press <Kbd>⌘K</Kbd> for the command menu</span>
        </div>
      </Section>

      <Section title="Cards, empty, skeleton">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card><CardHeader><CardTitle>Card title</CardTitle><CardDescription>Description text.</CardDescription></CardHeader><CardContent className="text-sm">Card content.</CardContent></Card>
          <Panel heading="Panel">Panel content under a hairline heading.</Panel>
          <EmptyState cause="no-results" />
          <div className="flex flex-col gap-2 rounded-lg border border-hairline p-4"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
        </div>
      </Section>

      <Section title="Table and grouped list">
        <div className="overflow-hidden rounded-lg border border-hairline">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Sessions</TableHead></TableRow></TableHeader>
            <TableBody>
              {PROVIDERS.slice(0, 4).map((p, i) => (
                <TableRow key={p.id} data-state={i === 1 ? 'selected' : undefined}>
                  <TableCell className="text-primary">{p.name}</TableCell><TableCell><StatusBadge status={p.status} /></TableCell><TableCell className="text-right tabular-nums">{p.sessions}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="overflow-hidden rounded-lg border border-hairline">
          <List>
            <ListGroup icon={<StatusIcon state="progress" tone="warning" />} title="Under review" count={2}>
              {PROVIDERS.filter((p) => p.status === 'under_review').map((p) => (
                <ListRow key={p.id}><ListId>{p.id}</ListId><span className="truncate text-primary">{p.name}</span><span className="ml-auto text-xs text-tertiary">{p.joined}</span></ListRow>
              ))}
            </ListGroup>
            <ListGroup icon={<StatusIcon state="done" tone="success" />} title="Active" count={3} defaultOpen={false}><ListRow>Hidden until opened</ListRow></ListGroup>
          </List>
        </div>
      </Section>

      <Section title="Stat cards and charts">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard {...KPIS[0]!} />
          <StatCard label="Plain value" value="Healthy" sub="No action needed" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Panel heading="Line / area"><Chart build={small} height={200} ariaLabel="Sessions over time" /></Panel>
          <Panel heading="Bar"><Chart build={bar} height={200} ariaLabel="Applications per week" /></Panel>
          <Panel heading="Donut"><Chart build={donut} height={200} ariaLabel="Providers by status" /></Panel>
          <Panel heading="Scatter"><Chart build={scatter} height={200} ariaLabel="Session length vs earnings" /></Panel>
          <Panel heading="Sparkline"><Chart build={spark} height={48} ariaLabel="Trend" /></Panel>
          <Panel heading="Empty / loading"><div className="grid gap-2"><Chart build={spark} empty height={64} ariaLabel="Empty" /><Chart build={spark} loading height={64} ariaLabel="Loading" /></div></Panel>
        </div>
      </Section>
    </div>
  );
}
