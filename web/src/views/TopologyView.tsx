import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { Crosshair, Flame, Palette } from 'lucide-react';
import type { GraphData, GraphNode, Head } from '../types/capture';

type TopoNode = GraphNode & SimulationNodeDatum;
type TopoLink = SimulationLinkDatum<TopoNode> & { relation: string; weight: number };

const BUCKET_COLORS: Record<string, string> = {
  idea: '#fbbf24', memory: '#34d399', reminder: '#fb7185', question: '#22d3ee', reference: '#a78bfa', noise: '#64717f',
};

function colorFor(node: TopoNode, heat: string, heads: Head[]): string {
  if (heat === 'bucket') return BUCKET_COLORS[node.bucket] ?? '#9aa7b4';
  const decision = node.decisions?.find((item) => item.headName === heat || item.headId === heat);
  const value = decision?.valueNum ?? 0;
  const head = heads.find((item) => item.name === heat);
  const max = head?.primitive === 'noul' ? 1 : (head?.config.max ?? 3);
  const t = Math.max(0, Math.min(1, value / (max || 1)));
  const r = Math.round(52 + t * 199);
  const g = Math.round(211 - t * 60);
  const b = Math.round(153 - t * 20);
  return `rgb(${r},${g},${b})`;
}

export function TopologyView({
  graph, heads, onSelect, heat, onHeat, decayDays, onDecayDays,
}: {
  graph: GraphData;
  heads: Head[];
  onSelect: (id: string) => void;
  heat: string;
  onHeat: (heat: string) => void;
  decayDays: number;
  onDecayDays: (days: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<TopoNode, TopoLink> | null>(null);
  const nodesRef = useRef<TopoNode[]>([]);
  const linksRef = useRef<TopoLink[]>([]);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ node: TopoNode | null; panning: boolean; lastX: number; lastY: number }>({ node: null, panning: false, lastX: 0, lastY: 0 });
  const hoverRef = useRef<TopoNode | null>(null);
  const [, forceRender] = useState(0);

  const heatOptions = useMemo(() => ['bucket', ...heads.filter((head) => head.primitive !== 'choice').map((head) => head.name)], [heads]);

  useEffect(() => {
    const nodes = graph.nodes.map((node) => ({ ...node })) as TopoNode[];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const links = graph.edges
      .filter((edge) => byId.has(edge.sourceId) && byId.has(edge.targetId))
      .map((edge) => ({ source: edge.sourceId, target: edge.targetId, relation: edge.relation, weight: edge.weight })) as TopoLink[];

    const simulation = forceSimulation(nodes)
      .force('link', forceLink<TopoNode, TopoLink>(links).id((node) => node.id).distance(70).strength(0.35))
      .force('charge', forceManyBody<TopoNode>().strength(-140))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<TopoNode>().radius(16))
      .alphaDecay(0.035)
      .on('tick', () => forceRender((value) => value + 1));

    simRef.current = simulation;
    nodesRef.current = nodes;
    linksRef.current = links;
    return () => { simulation.stop(); };
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    let raf = 0;
    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const transform = transformRef.current;
      ctx.save();
      ctx.translate(rect.width / 2 + transform.x, rect.height / 2 + transform.y);
      ctx.scale(transform.k, transform.k);

      const pulse = 0.55 + Math.sin(Date.now() / 280) * 0.35;
      for (const link of linksRef.current) {
        const source = link.source as TopoNode;
        const target = link.target as TopoNode;
        if (source.x === undefined || target.x === undefined || source.y === undefined || target.y === undefined) continue;
        const paradox = link.relation === 'paradox' || link.relation === 'contradicts';
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = paradox
          ? `rgba(251,113,133,${pulse})`
          : link.relation === 'reinforces' || link.relation === 'refines'
            ? 'rgba(52,211,153,0.28)'
            : 'rgba(100,113,127,0.3)';
        ctx.lineWidth = paradox ? 1.6 : 1;
        ctx.setLineDash(paradox ? [5, 4] : []);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      for (const node of nodesRef.current) {
        if (node.x === undefined || node.y === undefined) continue;
        const energy = Math.max(0.2, Math.min(2, node.effectiveEnergy ?? node.energy));
        const radius = 4 + energy * 5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = colorFor(node, heat, heads);
        ctx.globalAlpha = node === hoverRef.current ? 1 : 0.82;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (node.isPinned) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }

      const hovered = hoverRef.current;
      if (hovered && hovered.x !== undefined && hovered.y !== undefined) {
        const node = hovered as TopoNode & { x: number; y: number };
        const label = node.content.slice(0, 60);
        ctx.font = '11px Inter, sans-serif';
        const width = ctx.measureText(label).width + 14;
        ctx.fillStyle = 'rgba(9,11,13,0.94)';
        ctx.strokeStyle = '#2a343e';
        ctx.lineWidth = 1;
        ctx.fillRect(node.x + 10, node.y - 20, width, 22);
        ctx.strokeRect(node.x + 10, node.y - 20, width, 22);
        ctx.fillStyle = '#e6edf3';
        ctx.fillText(label, node.x + 17, node.y - 5);
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      return {
        x: (clientX - rect.left - rect.width / 2 - t.x) / t.k,
        y: (clientY - rect.top - rect.height / 2 - t.y) / t.k,
      };
    };

    const hit = (clientX: number, clientY: number): TopoNode | null => {
      const point = toWorld(clientX, clientY);
      for (const node of nodesRef.current) {
        if (node.x === undefined || node.y === undefined) continue;
        const radius = 8 + Math.max(0.2, Math.min(2, node.effectiveEnergy ?? node.energy)) * 5;
        if (Math.hypot(node.x - point.x, node.y - point.y) <= radius) return node;
      }
      return null;
    };

    const onPointerDown = (event: PointerEvent) => {
      const node = hit(event.clientX, event.clientY);
      dragRef.current = { node, panning: !node, lastX: event.clientX, lastY: event.clientY };
      if (node) { node.fx = node.x; node.fy = node.y; }
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag.node) {
        const point = toWorld(event.clientX, event.clientY);
        drag.node.fx = point.x;
        drag.node.fy = point.y;
        simRef.current?.alphaTarget(0.15).restart();
      } else if (drag.panning) {
        transformRef.current.x += event.clientX - drag.lastX;
        transformRef.current.y += event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
      } else {
        hoverRef.current = hit(event.clientX, event.clientY);
      }
    };
    const onPointerUp = () => {
      const drag = dragRef.current;
      if (drag.node) { drag.node.fx = null; drag.node.fy = null; simRef.current?.alphaTarget(0); }
      dragRef.current = { node: null, panning: false, lastX: 0, lastY: 0 };
    };
    const onClick = (event: MouseEvent) => {
      const node = hit(event.clientX, event.clientY);
      if (node) onSelect(node.id);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      transformRef.current.k = Math.max(0.25, Math.min(3, transformRef.current.k * (event.deltaY > 0 ? 0.9 : 1.1)));
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [heat, heads, onSelect]);

  const decayedCount = decayDays > 0 ? graph.nodes.filter((node) => (node.effectiveEnergy ?? node.energy) * Math.exp(-0.05 * decayDays) < 0.15).length : 0;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#070a0c]">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded border border-[var(--border)] bg-[#0b0e11]/90 px-2.5 py-1.5">
        <Palette size={12} className="text-[var(--muted)]" />
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Heatmap</span>
        <select value={heat} onChange={(event) => onHeat(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[11px] outline-none">
          {heatOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-2 rounded border border-[var(--border)] bg-[#0b0e11]/90 px-2.5 py-1.5">
        <Flame size={12} className="text-[var(--amber)]" />
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Simulate decay</span>
        <input type="range" min={0} max={60} value={decayDays} onChange={(event) => onDecayDays(Number(event.target.value))} className="h-1 w-24 accent-[var(--amber)]" />
        <span className="mono text-[10px] text-[var(--text)]">+{decayDays}d</span>
        {decayDays > 0 ? <span className="mono text-[10px] text-[var(--rose)]">{decayedCount} die</span> : null}
      </div>
      <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded border border-[var(--border)] bg-[#0b0e11]/90 px-2.5 py-1.5 text-[10px] text-[var(--muted)]">
        <span className="flex items-center gap-1"><Crosshair size={11} /> {graph.nodes.length} nodes · {graph.edges.length} edges</span>
        <span>radius = energy</span>
        <span className="text-[var(--rose)]">dashed red = paradox / contradicts</span>
      </div>
    </div>
  );
}
