import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { Activity, Cable, CircleAlert, Download, GitBranch, Layers, Maximize2, Minus, Network, Plus, RefreshCw, RotateCcw, Save, Search, X } from 'lucide-react';

cytoscape.use(fcose);

const api = 'http://127.0.0.1:8001/api/v1';
const TOPOLOGY_LAYOUT_KEY = 'aims-topology-static-layout-v1';
const TOPOLOGY_WIDTH = 2600;
const TOPOLOGY_HEIGHT = 1500;
const DEFAULT_VIEWBOX: ViewBox = { x: 0, y: 0, width: 1100, height: 620 };

type LayoutMode = 'dynamic' | 'static';
type TopologyNode = {
  id: string;
  device_id?: number | null;
  name: string;
  ip?: string | null;
  status?: string | null;
  role?: string | null;
  site?: string | null;
  managed?: boolean;
  ingest_status?: string | null;
};
type TopologyLink = {
  id: number;
  source?: string | null;
  target?: string | null;
  local_device_id?: number | null;
  remote_device_id?: number | null;
  local_device_name: string;
  local_ip: string;
  local_interface: string;
  remote_device_name: string;
  remote_ip: string;
  remote_interface: string;
  protocol: string;
  last_seen_at?: string | null;
};
type TopologyData = {
  nodes: TopologyNode[];
  links: TopologyLink[];
  summary: { devices: number; nodes?: number; links: number };
};
type GraphNode = TopologyNode & { degree: number };
type GraphLayout = {
  nodes: GraphNode[];
  links: TopologyLink[];
  positions: Record<string, { x: number; y: number }>;
};
type PositionMap = Record<string, { x: number; y: number }>;
type DragState = { id: string; offsetX: number; offsetY: number } | null;
type ViewBox = { x: number; y: number; width: number; height: number };
type PanState = { clientX: number; clientY: number; viewBox: ViewBox } | null;
type MapTooltip = {
  kind: 'node' | 'edge';
  x: number;
  y: number;
  title: string;
  lines: string[];
} | null;

function isLightThemeActive() {
  return document.body.classList.contains('theme-light');
}

function cssColorVar(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function TopologyPage() {
  const [token, setToken] = useState(localStorage.getItem('aims-api-token') || '');
  const [data, setData] = useState<TopologyData>({ nodes: [], links: [], summary: { devices: 0, links: 0 } });
  const [query, setQuery] = useState('');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('static');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [savedPositions, setSavedPositions] = useState<PositionMap>(() => loadSavedLayout());
  const [draftPositions, setDraftPositions] = useState<PositionMap>(() => loadSavedLayout());
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const cytoscapeRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const layoutModeRef = useRef<LayoutMode>(layoutMode);
  const layoutTimerRef = useRef<number | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [panState, setPanState] = useState<PanState>(null);
  const [renderPositions, setRenderPositions] = useState<PositionMap>({});
  const [mapTooltip, setMapTooltip] = useState<MapTooltip>(null);
  const [focusSelected, setFocusSelected] = useState(false);
  const [hideNotIngested, setHideNotIngested] = useState(false);
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEWBOX);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [lightTheme, setLightTheme] = useState(() => isLightThemeActive());
  const pinnedTooltipRef = useRef(false);

  const ensureToken = async (force = false) => {
    if (token && !force) return token;
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@aims.local', password: 'ChangeMe123!' }),
    });
    const json = await response.json();
    if (!response.ok || !json.data?.token) throw new Error(json.message || 'Unable to authenticate.');
    localStorage.setItem('aims-api-token', json.data.token);
    setToken(json.data.token);
    return json.data.token as string;
  };

  const load = async () => {
    setLoading(true);
    try {
      let auth = await ensureToken();
      let response = await fetch(`${api}/topology`, { headers: { Authorization: `Bearer ${auth}` } });
      if (response.status === 401) {
        localStorage.removeItem('aims-api-token');
        auth = await ensureToken(true);
        response = await fetch(`${api}/topology`, { headers: { Authorization: `Bearer ${auth}` } });
      }
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load topology.');
      setData(json.data || { nodes: [], links: [], summary: { devices: 0, links: 0 } });
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load topology.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const syncTheme = () => setLightTheme(isLightThemeActive());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const topology = useMemo(() => dedupeTopology(data.nodes, data.links), [data.nodes, data.links]);
  const notIngestedNodes = useMemo(() => topology.nodes.filter((node) => !node.managed), [topology.nodes]);
  const managedNodeCount = useMemo(() => topology.nodes.filter((node) => node.managed).length, [topology.nodes]);
  const offlineNodeCount = useMemo(() => topology.nodes.filter((node) => /offline|down|failed|unreachable/i.test(`${node.status || ''} ${node.ingest_status || ''}`)).length, [topology.nodes]);
  const visibleNodes = useMemo(() => (
    hideNotIngested ? topology.nodes.filter((node) => node.managed) : topology.nodes
  ), [topology.nodes, hideNotIngested]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const filteredLinks = useMemo(() => {
    const value = query.trim().toLowerCase();
    return topology.links.filter((link) => {
      if (!visibleNodeIds.has(String(link.source || '')) || !visibleNodeIds.has(String(link.target || ''))) return false;
      if (!value) return true;
      return [
        link.local_device_name,
        link.local_ip,
        link.local_device_id,
        link.local_interface,
        link.remote_device_name,
        link.remote_ip,
        link.remote_device_id,
        link.remote_interface,
        link.protocol,
      ].join(' ').toLowerCase().includes(value);
    });
  }, [topology.links, query, visibleNodeIds]);
  const graph = useMemo(() => graphLayout(visibleNodes, filteredLinks, layoutMode, draftPositions), [visibleNodes, filteredLinks, layoutMode, draftPositions]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) || graph.nodes[0] || null;
  const activeLinks = selectedNode ? filteredLinks.filter((link) => link.source === selectedNode.id || link.target === selectedNode.id) : [];
  const hasUnsavedLayout = JSON.stringify(savedPositions) !== JSON.stringify(draftPositions);
  const autoFitSignature = `${layoutMode}|${graph.nodes.map((node) => node.id).join(',')}|${filteredLinks.length}`;
  const selectedCanIngest = selectedNode && !selectedNode.managed;
  const exportGraph = useMemo(() => ({ ...graph, positions: { ...graph.positions, ...renderPositions } }), [graph, renderPositions]);
  const hasVisibleTopology = filteredLinks.length > 0;

  useEffect(() => {
    if (graph.nodes.length) setViewBox(fitViewBox(graph));
  }, [autoFitSignature]);

  useEffect(() => {
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);

  useEffect(() => {
    if (!cytoscapeRef.current || cyRef.current) return;
    const cy = cytoscape({
      container: cytoscapeRef.current,
      minZoom: 0.08,
      maxZoom: 3.2,
      wheelSensitivity: 0.18,
      textureOnViewport: true,
      motionBlur: true,
      motionBlurOpacity: 0.18,
      hideEdgesOnViewport: graph.nodes.length > 180,
      boxSelectionEnabled: false,
      autoungrabify: false,
      style: cytoscapeStyles(lightTheme),
    });
    cyRef.current = cy;
    cy.on('tap', (event) => {
      if (event.target === cy) {
        pinnedTooltipRef.current = false;
        setMapTooltip(null);
      }
    });
    cy.on('tap', 'node', (event) => {
      setSelectedNodeId(event.target.id());
      pinnedTooltipRef.current = true;
      setMapTooltip(nodeTooltip(event.target, event.renderedPosition));
    });
    cy.on('mouseover', 'node', (event) => {
      if (cy.zoom() < 0.34) return;
      pinnedTooltipRef.current = false;
      setMapTooltip(nodeTooltip(event.target, event.renderedPosition));
    });
    cy.on('mouseout', 'node', () => {
      if (!pinnedTooltipRef.current) setMapTooltip(null);
    });
    cy.on('tap', 'edge', (event) => {
      pinnedTooltipRef.current = true;
      setMapTooltip(edgeTooltip(event.target, event.renderedPosition));
    });
    cy.on('mouseover', 'edge', (event) => {
      pinnedTooltipRef.current = false;
      setMapTooltip(edgeTooltip(event.target, event.renderedPosition));
    });
    cy.on('mouseout', 'edge', () => {
      if (!pinnedTooltipRef.current) setMapTooltip(null);
    });
    cy.on('zoom pan', () => {
      updateZoomLabelClass(cy);
      if (!pinnedTooltipRef.current) setMapTooltip(null);
    });
    cy.on('dragfree', 'node', (event) => {
      const node = event.target;
      const position = { x: node.position('x'), y: node.position('y') };
      setRenderPositions((current) => ({ ...current, [node.id()]: position }));
      if (layoutModeRef.current === 'static') {
        setDraftPositions((current) => ({ ...current, [node.id()]: position }));
      }
    });
    cy.on('layoutstop', () => setRenderPositions(captureCytoscapePositions(cy)));
    return () => {
      if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current);
      cy.destroy();
      cyRef.current = null;
    };
  }, [hasVisibleTopology]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style().fromJson(cytoscapeStyles(lightTheme)).update();
  }, [lightTheme]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(cytoscapeElements(graph));
      applyGraphFocus(cy, selectedNode?.id || '', focusSelected);
      updateZoomLabelClass(cy);
    });
    if (!graph.nodes.length) return;
    if (layoutTimerRef.current) {
      window.clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = null;
    }
    if (layoutMode === 'static') {
      graph.nodes.forEach((node) => {
        const position = draftPositions[node.id] || graph.positions[node.id];
        if (position) cy.getElementById(node.id).position(position);
      });
      cy.layout({ name: 'preset', fit: true, padding: 35, animate: false }).run();
      setRenderPositions(captureCytoscapePositions(cy));
      return;
    }
    graph.nodes.forEach((node) => {
      const position = graph.positions[node.id];
      if (position) cy.getElementById(node.id).position(position);
    });
    cy.layout({ name: 'preset', fit: true, padding: 35, animate: false }).run();
    setRenderPositions(captureCytoscapePositions(cy));
    if (graph.nodes.length > 240) return;
    layoutTimerRef.current = window.setTimeout(() => {
      if (cyRef.current !== cy) return;
      cy.layout({
        name: 'fcose',
        quality: graph.nodes.length > 90 ? 'draft' : 'default',
        animate: false,
        randomize: false,
        fit: true,
        padding: 35,
        nodeDimensionsIncludeLabels: false,
        nodeRepulsion: 3200,
        idealEdgeLength: graph.nodes.length > 180 ? 58 : 74,
        edgeElasticity: 0.42,
        gravity: 0.38,
        numIter: graph.nodes.length > 180 ? 260 : 700,
      } as cytoscape.LayoutOptions).run();
      layoutTimerRef.current = null;
    }, 60);
    return () => {
      if (layoutTimerRef.current) {
        window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = null;
      }
    };
  }, [graph, layoutMode, draftPositions]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyGraphFocus(cy, selectedNode?.id || '', focusSelected);
  }, [selectedNode?.id, focusSelected, graph.links]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const zoomOnly = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 0.86 : 1.16;
      const pointer = svgPoint(canvas, event);
      setViewBox((current) => zoomViewBox(current, factor, pointer));
    };
    canvas.addEventListener('wheel', zoomOnly, { passive: false });
    return () => canvas.removeEventListener('wheel', zoomOnly);
  }, [graph.nodes.length]);

  const saveStaticLayout = () => {
    const positions = cyRef.current ? captureCytoscapePositions(cyRef.current) : draftPositions;
    localStorage.setItem(TOPOLOGY_LAYOUT_KEY, JSON.stringify(positions));
    setDraftPositions(positions);
    setSavedPositions(positions);
    setRenderPositions(positions);
    setMessage('Static network map arrangement saved.');
  };

  const resetStaticLayout = () => {
    localStorage.removeItem(TOPOLOGY_LAYOUT_KEY);
    setSavedPositions({});
    setDraftPositions({});
    setMessage('Static network map arrangement reset.');
  };

  const fitMap = () => {
    if (cyRef.current && graph.nodes.length) cyRef.current.fit(undefined, 35);
  };

  const zoomMap = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const container = cy.container();
    const level = clamp(cy.zoom() / factor, cy.minZoom(), cy.maxZoom());
    cy.zoom({
      level,
      renderedPosition: {
        x: (container?.clientWidth || 1) / 2,
        y: (container?.clientHeight || 1) / 2,
      },
    });
  };

  const exportDrawio = () => {
    const xml = buildDrawioXml(exportGraph);
    const blob = new Blob([xml], { type: 'application/vnd.jgraph.mxfile' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `network-topology-${new Date().toISOString().slice(0, 10)}.drawio`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const ingestNeighbors = async (fullScan: boolean, ids: string[]) => {
    const nodeIds = Array.from(new Set(ids)).filter(Boolean);
    if (!nodeIds.length) {
      setMessage('Select at least one not-ingested neighbor first.');
      return;
    }
    setIngesting(true);
    setMessage(fullScan ? 'Full scanning and ingesting selected neighbors...' : 'Ingesting selected neighbors...');
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/topology/ingest-neighbors`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_ids: nodeIds, full_scan: fullScan }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Neighbor ingest failed.');
      const result = json.data || {};
      setMessage(`Ingest complete. ${result.created || 0} created, ${result.updated || 0} updated, ${result.scanned || 0} full scanned, ${result.skipped || 0} skipped.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Neighbor ingest failed.');
    } finally {
      setIngesting(false);
    }
  };

  const startPan = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget || dragState) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanState({ clientX: event.clientX, clientY: event.clientY, viewBox });
  };

  const startNodeDrag = (event: PointerEvent<SVGGElement>, nodeId: string) => {
    if (layoutMode !== 'static') {
      setSelectedNodeId(nodeId);
      return;
    }
    const svg = event.currentTarget.ownerSVGElement;
    const position = graph.positions[nodeId];
    if (!svg || !position) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = svgPoint(svg, event);
    setSelectedNodeId(nodeId);
    setDragState({ id: nodeId, offsetX: position.x - pointer.x, offsetY: position.y - pointer.y });
  };

  const moveNode = (event: PointerEvent<SVGSVGElement>) => {
    if (dragState && layoutMode === 'static') {
      const pointer = svgPoint(event.currentTarget, event);
      setDraftPositions((current) => ({
        ...current,
        [dragState.id]: {
          x: clamp(pointer.x + dragState.offsetX, 65, TOPOLOGY_WIDTH - 65),
          y: clamp(pointer.y + dragState.offsetY, 45, TOPOLOGY_HEIGHT - 45),
        },
      }));
      return;
    }
    if (panState) {
      const rect = event.currentTarget.getBoundingClientRect();
      const scaleX = panState.viewBox.width / Math.max(rect.width, 1);
      const scaleY = panState.viewBox.height / Math.max(rect.height, 1);
      setViewBox(clampViewBox({
        ...panState.viewBox,
        x: panState.viewBox.x - (event.clientX - panState.clientX) * scaleX,
        y: panState.viewBox.y - (event.clientY - panState.clientY) * scaleY,
      }));
    }
  };

  return (
    <div className="content topology-page">
      <div className="page-title">
        <div>
          <h1>Network Map <span className="topology-live-badge"><i /> Real-time</span></h1>
          <p>IP-identified cable topology discovered from LLDP and CDP neighbor tables.</p>
        </div>
        <button className="plain-button" onClick={load}><RefreshCw size={16} /> {loading ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      {message && <div className="module-notice topology-notice">{message}<button onClick={() => setMessage('')}><X size={15} /></button></div>}

      <div className="topology-summary">
        <div className="inventory"><Network size={18} /><p>Inventory devices</p><b>{data.summary.devices}</b><span>{managedNodeCount} visible on map</span></div>
        <div className="nodes"><Layers size={18} /><p>Unique IP nodes</p><b>{topology.nodes.length}</b><span>{offlineNodeCount} down or unreachable</span></div>
        <div className="pending"><Plus size={18} /><p>Not ingested</p><b>{notIngestedNodes.length}</b><span>Neighbors awaiting import</span></div>
        <div className="links"><Cable size={18} /><p>Unique links</p><b>{topology.links.length}</b><span>{activeLinks.length} linked to selected</span></div>
        <div className="shown"><GitBranch size={18} /><p>Shown links</p><b>{filteredLinks.length}</b><span>{query.trim() ? 'Filtered results' : 'All discovered links'}</span></div>
      </div>

      <section className="card topology-graph-card">
        <div className="topology-toolbar">
          <div>
            <div className="card-title">Cable Topology <small>{graph.nodes.length} nodes shown</small></div>
            <span>Devices are merged by management IP first, then inventory ID or neighbor name.</span>
          </div>
          <div className="topology-tools">
            <div className="segmented-control">
              <button className={layoutMode === 'dynamic' ? 'active' : ''} onClick={() => setLayoutMode('dynamic')}>Dynamic</button>
              <button className={layoutMode === 'static' ? 'active' : ''} onClick={() => setLayoutMode('static')}>Static</button>
            </div>
            <label className="topology-check"><input type="checkbox" checked={focusSelected} onChange={(event) => setFocusSelected(event.target.checked)} /> Focus</label>
            <label className="topology-check"><input type="checkbox" checked={hideNotIngested} onChange={(event) => setHideNotIngested(event.target.checked)} /> Hide not ingested</label>
            <button className="plain-button topology-save" disabled={!graph.nodes.length} onClick={exportDrawio}><Download size={14} /> Draw.io</button>
            <button className="plain-button topology-save" disabled={layoutMode !== 'static' || !hasUnsavedLayout} onClick={saveStaticLayout}><Save size={14} /> Save</button>
            <button className="plain-button topology-save" disabled={layoutMode !== 'static'} onClick={resetStaticLayout}><RotateCcw size={14} /> Reset</button>
            <div className="topology-zoom-controls">
              <button type="button" onClick={() => zoomMap(0.82)} title="Zoom in"><Plus size={14} /></button>
              <button type="button" onClick={() => zoomMap(1.18)} title="Zoom out"><Minus size={14} /></button>
              <button type="button" onClick={fitMap} title="Fit all devices"><Maximize2 size={14} /></button>
            </div>
            <div className="table-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search device, IP, interface..." />
            </div>
          </div>
        </div>

        {filteredLinks.length ? (
          <div className="topology-stage">
            <div className="topology-map-shell">
              <div
                ref={cytoscapeRef}
                className={`topology-canvas topology-cytoscape ${layoutMode === 'static' ? 'editable' : ''}`}
                role="img"
                aria-label="Discovered network topology"
              />
              {mapTooltip && (
                <div className={`topology-map-tooltip ${mapTooltip.kind}`} style={{ left: mapTooltip.x + 14, top: mapTooltip.y + 14 }}>
                  <b>{mapTooltip.title}</b>
                  {mapTooltip.lines.map((line) => <span key={line}>{line}</span>)}
                </div>
              )}
              <div className="topology-map-legend" aria-hidden="true">
                <span><i className="managed" /> Managed</span>
                <span><i className="neighbor" /> Neighbor</span>
                <span><i className="active" /> Selected path</span>
                <span><i className="warning" /> Needs ingest</span>
              </div>
              <div className="topology-mini-map" aria-hidden="true">
                {graph.nodes.slice(0, 28).map((node, index) => (
                  <i
                    key={node.id}
                    className={node.managed ? 'managed' : 'neighbor'}
                    style={{
                      left: `${10 + ((index * 23) % 80)}%`,
                      top: `${18 + ((index * 37) % 62)}%`,
                    }}
                  />
                ))}
              </div>
            </div>

            <aside className="topology-inspector">
              <div className="topology-inspector-head">
                <span className={selectedNode?.managed ? 'managed' : 'neighbor'}>{selectedNode?.managed ? <Network size={16} /> : <CircleAlert size={16} />}</span>
                <div>
                  <h3>{selectedNode?.name || 'No node selected'}</h3>
                  <p>{selectedNode?.managed ? 'Managed inventory device' : 'Discovered neighbor'}</p>
                </div>
              </div>
              <div className="topology-inspector-health">
                <span><Activity size={14} /> {selectedNode?.ingest_status || selectedNode?.status || 'Unknown'}</span>
                <span><Cable size={14} /> {activeLinks.length} links</span>
              </div>
              {layoutMode === 'static' && <p className="topology-hint">Drag devices in Static mode, then save the arrangement.</p>}
              <dl>
                <dt>Device ID</dt><dd>{selectedNode?.device_id ? `#${selectedNode.device_id}` : 'Not ingested'}</dd>
                <dt>Map identity</dt><dd>{selectedNode?.id || '-'}</dd>
                <dt>Management IP</dt><dd>{selectedNode?.ip || '-'}</dd>
                <dt>Status</dt><dd>{selectedNode?.ingest_status || selectedNode?.status || '-'}</dd>
                <dt>Role</dt><dd>{selectedNode?.role || '-'}</dd>
                <dt>Site</dt><dd>{selectedNode?.site || '-'}</dd>
                <dt>Links</dt><dd>{activeLinks.length}</dd>
              </dl>
              {selectedCanIngest && (
                <div className="topology-inspector-actions">
                  <button className="plain-button" disabled={ingesting} onClick={() => ingestNeighbors(false, [selectedNode.id])}><Plus size={14} /> Ingest device</button>
                  <button className="plain-button" disabled={ingesting || !selectedNode.ip} onClick={() => ingestNeighbors(true, [selectedNode.id])}><RefreshCw size={14} /> Full scan + ingest</button>
                </div>
              )}
              <div className="topology-link-list">
                {activeLinks.slice(0, 8).map((link) => {
                  const view = linkViewForNode(link, selectedNode?.id || '');
                  return (
                    <p key={link.id}>
                      <b>{view.localInterface || '-'}</b>
                      <span>to {view.remoteDevice || '-'} {view.remoteInterface ? `on ${view.remoteInterface}` : ''}</span>
                      <em>{(link.protocol || 'neighbor').toUpperCase()}</em>
                    </p>
                  );
                })}
                {!activeLinks.length && <p>No links selected.</p>}
              </div>
            </aside>
          </div>
        ) : (
          <div className="empty topology-empty">No discovered LLDP/CDP links yet. Run Auto Scan with SNMP credentials against switches or routers that expose neighbor tables.</div>
        )}
      </section>

    </div>
  );
}

function dedupeTopology(nodes: TopologyNode[], links: TopologyLink[]) {
  const alias = new Map<string, string>();
  const nodeMap = new Map<string, GraphNode>();
  const canonical = (id?: string | null, ip?: string | null, name?: string | null) => {
    if (id && alias.has(id)) return alias.get(id)!;
    const nameAlias = alias.get(nameKey(name));
    if (nameAlias) {
      if (id) alias.set(id, nameAlias);
      return nameAlias;
    }
    const ipAlias = alias.get(ipKey(ip));
    if (ipAlias) {
      if (id) alias.set(id, ipAlias);
      return ipAlias;
    }
    const key = ipKey(ip) || id || nameKey(name);
    if (id && key) alias.set(id, key);
    return key;
  };

  nodes.forEach((node) => {
    const id = ipKey(node.ip) || node.id || nameKey(node.name);
    if (!id) return;
    mergeNode(nodeMap, id, node);
    alias.set(node.id, id);
    if (node.ip) alias.set(ipKey(node.ip), id);
    if (node.name) {
      alias.set(nameKey(node.name), id);
      alias.set(nameKey(shortHostname(node.name)), id);
    }
  });

  const uniqueLinks = new Map<string, TopologyLink>();
  links.forEach((link) => {
    const source = canonical(link.source, link.local_ip, link.local_device_name);
    const target = canonical(link.target, link.remote_ip, link.remote_device_name);
    if (!source || !target || source === target) return;
    mergeNode(nodeMap, source, {
      id: source,
      name: link.local_device_name || link.local_ip,
      ip: link.local_ip,
      managed: Boolean(link.local_device_id),
      device_id: link.local_device_id,
      role: 'Discovered Device',
      status: 'Discovered',
    });
    mergeNode(nodeMap, target, {
      id: target,
      name: link.remote_device_name || link.remote_ip,
      ip: link.remote_ip,
      managed: Boolean(link.remote_device_id),
      device_id: link.remote_device_id,
      role: 'Neighbor',
      status: 'Discovered',
    });
    const key = physicalLinkKey(source, link.local_interface, target, link.remote_interface);
    const normalizedLink = { ...link, source, target };
    if (uniqueLinks.has(key)) {
      mergePhysicalLink(uniqueLinks.get(key)!, normalizedLink);
    } else {
      uniqueLinks.set(key, normalizedLink);
    }
  });

  uniqueLinks.forEach((link) => {
    if (link.source) nodeMap.get(link.source)!.degree += 1;
    if (link.target) nodeMap.get(link.target)!.degree += 1;
  });

  return {
    nodes: Array.from(nodeMap.values()).sort((a, b) => b.degree - a.degree || (a.name || '').localeCompare(b.name || '')),
    links: Array.from(uniqueLinks.values()),
  };
}

function mergeNode(map: Map<string, GraphNode>, id: string, node: TopologyNode) {
  const existing = map.get(id);
  if (!existing) {
    map.set(id, { ...node, id, degree: 0, managed: Boolean(node.managed) });
    return;
  }
  existing.managed = Boolean(existing.managed || node.managed);
  existing.device_id = existing.device_id || node.device_id;
  existing.name = existing.name || node.name;
  existing.ip = existing.ip || node.ip;
  existing.status = existing.status || node.status;
  existing.role = existing.role || node.role;
  existing.site = existing.site || node.site;
}

function physicalLinkKey(source: string, sourceInterface: string, target: string, targetInterface: string) {
  return [
    `${source}|${(sourceInterface || '').trim().toLowerCase()}`,
    `${target}|${(targetInterface || '').trim().toLowerCase()}`,
  ].sort().join('::');
}

function mergePhysicalLink(existing: TopologyLink, candidate: TopologyLink) {
  existing.protocol = mergeProtocols(existing.protocol, candidate.protocol);
  if (!existing.last_seen_at && candidate.last_seen_at) existing.last_seen_at = candidate.last_seen_at;
  existing.local_device_id = existing.local_device_id || candidate.local_device_id;
  existing.remote_device_id = existing.remote_device_id || candidate.remote_device_id;
}

function mergeProtocols(left?: string | null, right?: string | null) {
  const protocols = new Set<string>();
  [left, right].forEach((value) => String(value || '').split('/').forEach((part) => {
    const normalized = part.trim().toLowerCase();
    if (normalized) protocols.add(normalized);
  }));
  return Array.from(protocols).sort().join('/') || 'neighbor';
}

function linkViewForNode(link: TopologyLink, nodeId: string) {
  const selectedIsTarget = link.target === nodeId;
  return {
    localInterface: selectedIsTarget ? link.remote_interface : link.local_interface,
    remoteInterface: selectedIsTarget ? link.local_interface : link.remote_interface,
    remoteDevice: selectedIsTarget ? (link.local_device_name || link.local_ip) : (link.remote_device_name || link.remote_ip),
  };
}

function nodeDisplayName(node: TopologyNode) {
  return node.name || node.ip || (node.device_id ? `Device #${node.device_id}` : 'Unknown');
}

function truncateLabel(value: string, maxLength: number) {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}...`;
}

function cytoscapeElements(graph: GraphLayout): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  graph.nodes.forEach((node) => {
    const identity = node.device_id ? `ID #${node.device_id}` : node.ip || 'Neighbor';
    const position = graph.positions[node.id] || { x: 0, y: 0 };
    const roleClass = roleClassForNode(node);
    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        label: truncateLabel(nodeDisplayName(node), 28),
        detailLabel: `${nodeDisplayName(node)}\n${identity}`,
        tooltip: `${nodeDisplayName(node)} | ${identity} | ${node.degree} links`,
        title: nodeDisplayName(node),
        identity,
        ip: node.ip || '',
        role: node.role || '',
        status: node.ingest_status || node.status || '',
        site: node.site || '',
        links: node.degree,
        icon: iconForRole(roleClass),
        shape: roleClass === 'endpoint' || roleClass === 'unknown' ? 'ellipse' : 'round-rectangle',
        managed: Boolean(node.managed),
      },
      classes: `${node.managed ? 'managed' : 'neighbor'} role-${roleClass}`,
      position,
    });
  });
  graph.links.forEach((link) => {
    if (!link.source || !link.target) return;
    elements.push({
      group: 'edges',
      data: {
        id: `link-${link.id}`,
        source: link.source,
        target: link.target,
        label: `${compactInterface(link.local_interface || '')} - ${compactInterface(link.remote_interface || '')}`,
        localDevice: link.local_device_name || link.local_ip || '',
        localInterface: link.local_interface || '',
        remoteDevice: link.remote_device_name || link.remote_ip || '',
        remoteInterface: link.remote_interface || '',
        protocol: link.protocol || 'neighbor',
      },
    });
  });
  return elements;
}

function cytoscapeStyles(lightTheme = false): cytoscape.StylesheetJson {
  const brandPrimary = cssColorVar('--brand-primary', lightTheme ? '#2563eb' : '#4f9af7');
  const palette = lightTheme
    ? {
      activeBg: brandPrimary,
      nodeBg: '#ffffff',
      nodeBorder: '#7aa2d8',
      nodeText: '#172033',
      nodeShadow: '#94a3b8',
      managedBg: '#eef7ff',
      managedBorder: brandPrimary,
      neighborBg: '#f8fafc',
      neighborBorder: '#94a3b8',
      neighborText: '#334155',
      selectedBg: '#fff7ed',
      selectedBorder: '#f59e0b',
      selectedText: '#172033',
      edge: '#5f7893',
      edgeText: '#334155',
      edgeTextBg: '#ffffff',
      activeEdge: '#f59e0b',
    }
    : {
      activeBg: brandPrimary,
      nodeBg: '#0e253b',
      nodeBorder: brandPrimary,
      nodeText: '#d9e8f7',
      nodeShadow: '#020914',
      managedBg: '#102a45',
      managedBorder: brandPrimary,
      neighborBg: '#15263a',
      neighborBorder: '#64748b',
      neighborText: '#b8cadd',
      selectedBg: '#17314b',
      selectedBorder: '#fbbf24',
      selectedText: '#f4f8ff',
      edge: '#4f9af7',
      edgeText: '#d6e7f8',
      edgeTextBg: '#071727',
      activeEdge: '#fbbf24',
    };
  return [
    {
      selector: 'core',
      style: {
        'active-bg-color': palette.activeBg,
        'active-bg-opacity': 0.12,
      },
    },
    {
      selector: 'node',
      style: {
        shape: 'data(shape)',
        width: 45,
        height: 45,
        'background-color': palette.nodeBg,
        'background-image': 'data(icon)',
        'background-fit': 'contain',
        'background-width-relative-to': 'inner',
        'background-height-relative-to': 'inner',
        'background-opacity': 1,
        'background-clip': 'none',
        'border-color': palette.nodeBorder,
        'border-width': 2,
        label: '',
        color: palette.nodeText,
        'font-family': 'DM Sans',
        'font-size': 10,
        'font-weight': 800,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': 120,
        'text-margin-y': 8,
        'line-height': 1.25,
        'overlay-opacity': 0,
        'shadow-blur': 9,
        'shadow-color': palette.nodeShadow,
        'shadow-opacity': lightTheme ? 0.2 : 0.42,
        'shadow-offset-x': 0,
        'shadow-offset-y': 7,
      },
    },
    {
      selector: 'node.managed',
      style: {
        'background-color': palette.managedBg,
        'border-color': palette.managedBorder,
      },
    },
    {
      selector: 'node.neighbor',
      style: {
        'background-color': palette.neighborBg,
        'border-color': palette.neighborBorder,
        color: palette.neighborText,
      },
    },
    {
      selector: 'node.zoom-label, node.active, node:selected',
      style: {
        label: 'data(label)',
      },
    },
    {
      selector: 'node:selected, node.active',
      style: {
        'border-color': palette.selectedBorder,
        'border-width': 3,
        'background-color': palette.selectedBg,
        color: palette.selectedText,
      },
    },
    {
      selector: 'node.role-switch',
      style: { shape: 'round-rectangle' },
    },
    {
      selector: 'node.role-router',
      style: { shape: 'round-rectangle' },
    },
    {
      selector: 'node.role-firewall',
      style: { shape: 'ellipse' },
    },
    {
      selector: 'node.role-endpoint, node.role-phone, node.role-unknown',
      style: { shape: 'ellipse' },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': palette.edge,
        opacity: lightTheme ? 0.82 : 0.72,
        'curve-style': 'bezier',
        'control-point-step-size': 26,
        label: '',
        color: palette.edgeText,
        'font-family': 'DM Sans',
        'font-size': 9,
        'font-weight': 800,
        'text-background-color': palette.edgeTextBg,
        'text-background-opacity': 0.86,
        'text-background-padding': 3,
        'text-rotation': 'autorotate',
        'text-margin-y': -6,
      },
    },
    {
      selector: 'edge.active',
      style: {
        width: 2,
        opacity: 0.9,
        'line-color': palette.activeEdge,
      },
    },
    {
      selector: '.dim',
      style: {
        opacity: 0.12,
      },
    },
  ] as cytoscape.StylesheetJson;
}

function applyGraphFocus(cy: Core, selectedId: string, focusSelected: boolean) {
  cy.elements().removeClass('active dim');
  cy.nodes().unselect();
  if (!selectedId) return;
  const selected = cy.getElementById(selectedId);
  if (!selected.length) return;
  selected.select().addClass('active');
  const connectedEdges = selected.connectedEdges();
  connectedEdges.addClass('active');
  connectedEdges.connectedNodes().addClass('active');
  if (focusSelected) {
    cy.elements().difference(connectedEdges.union(connectedEdges.connectedNodes())).addClass('dim');
    selected.removeClass('dim');
  }
}

function captureCytoscapePositions(cy: Core): PositionMap {
  const positions: PositionMap = {};
  cy.nodes().forEach((node) => {
    positions[node.id()] = { x: node.position('x'), y: node.position('y') };
  });
  return positions;
}

function updateZoomLabelClass(cy: Core) {
  const show = cy.zoom() >= 0.78;
  cy.nodes().toggleClass('zoom-label', show);
}

function nodeTooltip(node: cytoscape.NodeSingular, position: { x: number; y: number }): NonNullable<MapTooltip> {
  return {
    kind: 'node',
    x: position.x,
    y: position.y,
    title: String(node.data('title') || node.id()),
    lines: [
      String(node.data('identity') || ''),
      node.data('ip') ? `IP: ${node.data('ip')}` : '',
      node.data('role') ? `Role: ${node.data('role')}` : '',
      node.data('status') ? `Status: ${node.data('status')}` : '',
      node.data('site') ? `Site: ${node.data('site')}` : '',
      `Links: ${node.data('links') || 0}`,
    ].filter(Boolean),
  };
}

function edgeTooltip(edge: cytoscape.EdgeSingular, position: { x: number; y: number }): NonNullable<MapTooltip> {
  return {
    kind: 'edge',
    x: position.x,
    y: position.y,
    title: `${edge.data('localInterface') || '-'} -> ${edge.data('remoteInterface') || '-'}`,
    lines: [
      `${edge.data('localDevice') || '-'} to ${edge.data('remoteDevice') || '-'}`,
      `Protocol: ${String(edge.data('protocol') || 'neighbor').toUpperCase()}`,
    ],
  };
}

function roleClassForNode(node: TopologyNode) {
  const value = `${node.role || ''} ${node.name || ''} ${node.status || ''}`.toLowerCase();
  if (!node.managed && !node.device_id) return 'unknown';
  if (/firewall|security|asa|fortigate|palo|checkpoint/.test(value)) return 'firewall';
  if (/router|gateway|wan|edge/.test(value)) return 'router';
  if (/switch|core|access|distribution|catalyst|2960|3850/.test(value)) return 'switch';
  if (/wireless|\bap\b|wlan|wifi|aironet/.test(value)) return 'wireless';
  if (/phone|voip|sip|t21p|yealink/.test(value)) return 'phone';
  if (/server|vm|hypervisor|storage|database/.test(value)) return 'server';
  if (/printer|camera|workstation|endpoint|host|pc/.test(value)) return 'endpoint';
  return 'router';
}

function iconForRole(role: string) {
  const color = roleIconColor(role);
  const icons: Record<string, string> = {
    switch: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 15h25"/><path d="m28 9 7 6-7 6"/><path d="M40 33H15"/><path d="m20 27-7 6 7 6"/><path d="M12 24h24"/><path d="m31 18 7 6-7 6"/></g></svg>`,
    router: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="${color}"><circle cx="24" cy="24" r="7"/><path d="M22 3h4l2 13h-8zM22 32h4l2 13h-8zM3 22v4l13 2v-8zM32 20v8l13-2v-4zM8 9l3-3 11 8-6 6zM40 39l-3 3-11-8 6-6zM39 8l3 3-8 11-6-6zM9 40l-3-3 8-11 6 6z"/></g></svg>`,
    firewall: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="13" y="21" width="22" height="17" rx="2"/><path d="M17 21v-5a7 7 0 0 1 14 0v5"/><path d="M24 28v4"/></g></svg>`,
    wireless: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"><path d="M10 18a22 22 0 0 1 28 0"/><path d="M16 25a13 13 0 0 1 16 0"/><path d="M22 32a4 4 0 0 1 4 0"/></g><circle cx="24" cy="38" r="3" fill="${color}"/></svg>`,
    phone: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h18v34H15z"/><path d="M22 35h4"/><path d="M20 13h8"/></g></svg>`,
    server: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round"><rect x="10" y="8" width="28" height="12" rx="2"/><rect x="10" y="28" width="28" height="12" rx="2"/></g><g fill="${color}"><circle cx="17" cy="14" r="2"/><circle cx="17" cy="34" r="2"/></g></svg>`,
    endpoint: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="10" width="30" height="22" rx="2"/><path d="M19 39h10M24 32v7"/></g></svg>`,
    unknown: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="13" y="21" width="22" height="17" rx="2"/><path d="M17 21v-5a7 7 0 0 1 14 0v5"/><path d="M24 28v4"/></g></svg>`,
  };
  return svgDataUri(icons[role] || icons.router);
}

function roleIconColor(role: string) {
  const colors: Record<string, string> = {
    switch: '#69a8ff',
    router: '#5ee887',
    firewall: '#ffc255',
    wireless: '#ce8cff',
    phone: '#7dd3fc',
    server: '#b9cde0',
    endpoint: '#9fc9ff',
    unknown: '#94a3b8',
  };
  return colors[role] || '#69a8ff';
}

function svgDataUri(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildDrawioXml(graph: GraphLayout) {
  const nodeIds = new Map<string, string>();
  const cells = [
    '<mxCell id="0" />',
    '<mxCell id="1" parent="0" />',
  ];

  graph.nodes.forEach((node, index) => {
    const id = `node-${index + 2}`;
    nodeIds.set(node.id, id);
    const position = graph.positions[node.id] || { x: 0, y: 0 };
    const title = nodeDisplayName(node);
    const identity = node.device_id ? `ID #${node.device_id}` : node.ip || node.id;
    const roleClass = roleClassForNode(node);
    const value = `${escapeHtml(title)}&#xa;${escapeHtml(identity)}`;
    const shape = roleClass === 'endpoint' || roleClass === 'unknown' || roleClass === 'phone' || roleClass === 'firewall' ? 'ellipse' : 'roundRect';
    const fill = node.managed ? '#102a45' : '#15263a';
    const stroke = node.managed ? '#60a5fa' : '#64748b';
    cells.push(
      `<mxCell id="${id}" value="${escapeXml(value)}" style="shape=${shape};whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};strokeWidth=2;fontColor=#d9e8f7;fontSize=9;image=${escapeXml(iconForRole(roleClass))};imageWidth=28;imageHeight=28;imageAlign=center;imageVerticalAlign=middle;spacingTop=50;verticalAlign=top;" vertex="1" parent="1">` +
      `<mxGeometry x="${Math.round(position.x - 25)}" y="${Math.round(position.y - 25)}" width="50" height="50" as="geometry" />` +
      '</mxCell>',
    );
  });

  graph.links.forEach((link, index) => {
    const source = link.source ? nodeIds.get(link.source) : '';
    const target = link.target ? nodeIds.get(link.target) : '';
    if (!source || !target) return;
    const label = `${compactInterface(link.local_interface || '')} - ${compactInterface(link.remote_interface || '')}`.trim();
    cells.push(
      `<mxCell id="edge-${index + 1}" value="${escapeXml(label)}" style="endArrow=none;html=1;rounded=0;strokeColor=#4f9af7;fontColor=#d6e7f8;fontSize=8;" edge="1" parent="1" source="${source}" target="${target}">` +
      '<mxGeometry relative="1" as="geometry" />' +
      '</mxCell>',
    );
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<mxfile host="AIOIMS" modified="${escapeXml(new Date().toISOString())}" agent="AIOIMS" version="24.0.0">`,
    '<diagram id="network-topology" name="Network Topology">',
    '<mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="2600" pageHeight="1500" math="0" shadow="0">',
    `<root>${cells.join('')}</root>`,
    '</mxGraphModel>',
    '</diagram>',
    '</mxfile>',
  ].join('');
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(value: string) {
  return escapeHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function linkEndpointLabels(source: { x: number; y: number }, target: { x: number; y: number }, link: TopologyLink, slots: Record<string, number>) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const px = -uy;
  const py = ux;
  const sourceText = compactInterface(link.local_interface || '?');
  const targetText = compactInterface(link.remote_interface || '?');
  const sourceSlot = slots[endpointKey(link, 'source')] || 0;
  const targetSlot = slots[endpointKey(link, 'target')] || 0;
  return [
    endpointLabel('source', sourceText, source, ux, uy, px, py, sourceSlot),
    endpointLabel('target', targetText, target, -ux, -uy, px, py, targetSlot),
  ];
}

function endpointLabel(
  key: 'source' | 'target',
  text: string,
  node: { x: number; y: number },
  ux: number,
  uy: number,
  px: number,
  py: number,
  slot: number,
) {
  const direction = key === 'source' ? 1 : -1;
  const along = 148 + Math.abs(slot) * 16;
  const across = direction * 26 + slot * 24;
  return {
    key,
    text,
    x: node.x + ux * along + px * across,
    y: node.y + uy * along + py * across,
    width: labelWidth(text),
  };
}

function createEndpointLabelSlots(links: TopologyLink[], positions: Record<string, { x: number; y: number }>) {
  const groups = new Map<string, { key: string; angle: number }[]>();
  links.forEach((link) => {
    addEndpointGroup(groups, positions, link, 'source');
    addEndpointGroup(groups, positions, link, 'target');
  });
  const slots: Record<string, number> = {};
  groups.forEach((items) => {
    items.sort((a, b) => a.angle - b.angle);
    const center = (items.length - 1) / 2;
    items.forEach((item, index) => {
      slots[item.key] = index - center;
    });
  });
  return slots;
}

function addEndpointGroup(groups: Map<string, { key: string; angle: number }[]>, positions: Record<string, { x: number; y: number }>, link: TopologyLink, endpoint: 'source' | 'target') {
  const nodeId = endpoint === 'source' ? link.source : link.target;
  const otherId = endpoint === 'source' ? link.target : link.source;
  if (!nodeId || !otherId || !positions[nodeId] || !positions[otherId]) return;
  const node = positions[nodeId];
  const other = positions[otherId];
  const angle = Math.atan2(other.y - node.y, other.x - node.x);
  const bucket = Math.round(angle / (Math.PI / 8));
  const groupKey = `${nodeId}|${bucket}`;
  const current = groups.get(groupKey) || [];
  current.push({ key: endpointKey(link, endpoint), angle });
  groups.set(groupKey, current);
}

function endpointKey(link: TopologyLink, endpoint: 'source' | 'target') {
  return `${link.id}:${endpoint}`;
}

function compactInterface(value: string) {
  return value
    .replace(/TenGigabitEthernet/gi, 'Te')
    .replace(/GigabitEthernet/gi, 'Gi')
    .replace(/FastEthernet/gi, 'Fa')
    .replace(/Ethernet/gi, 'Eth')
    .replace(/Port-channel/gi, 'Po')
    .replace(/TwentyFiveGigE/gi, 'Twe')
    .replace(/FortyGigabitEthernet/gi, 'Fo');
}

function labelWidth(value: string) {
  return Math.max(44, Math.min(104, value.length * 7 + 14));
}

function graphLayout(nodes: GraphNode[], links: TopologyLink[], mode: LayoutMode, manualPositions: PositionMap): GraphLayout {
  const visibleIds = new Set<string>();
  links.forEach((link) => {
    if (link.source) visibleIds.add(link.source);
    if (link.target) visibleIds.add(link.target);
  });
  const visibleNodes = nodes.filter((node) => visibleIds.has(node.id)).slice(0, 320);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleLinks = links.filter((link) => Boolean(link.source && link.target && visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target)));
  const positions = mode === 'dynamic' ? seedLayout(visibleNodes) : staticLayout(visibleNodes, visibleLinks, manualPositions);
  return {
    nodes: visibleNodes,
    links: visibleLinks.filter((link) => Boolean(link.source && link.target && positions[link.source] && positions[link.target])),
    positions,
  };
}

function staticLayout(nodes: GraphNode[], links: TopologyLink[], manualPositions: PositionMap) {
  const positions: Record<string, { x: number; y: number }> = {};
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  links.forEach((link) => {
    if (!link.source || !link.target) return;
    adjacency.set(link.source, [...(adjacency.get(link.source) || []), link.target]);
    adjacency.set(link.target, [...(adjacency.get(link.target) || []), link.source]);
  });
  const tierById = new Map(nodes.map((node) => [node.id, topologyTier(node)]));
  const parentById = new Map<string, string>();
  nodes.forEach((node) => {
    const tier = tierById.get(node.id) ?? 3;
    const parent = (adjacency.get(node.id) || [])
      .map((id) => nodeById.get(id))
      .filter((candidate): candidate is GraphNode => Boolean(candidate))
      .filter((candidate) => (tierById.get(candidate.id) ?? 3) < tier)
      .sort((a, b) => (tierById.get(a.id)! - tierById.get(b.id)!) || b.degree - a.degree || nodeDisplayName(a).localeCompare(nodeDisplayName(b)))[0];
    if (parent) parentById.set(node.id, parent.id);
  });

  const tiers = new Map<number, GraphNode[]>();
  nodes.forEach((node) => {
    const tier = tierById.get(node.id) ?? 3;
    tiers.set(tier, [...(tiers.get(tier) || []), node]);
  });

  [0, 1, 2, 3, 4].forEach((tier) => {
    const row = (tiers.get(tier) || []).sort((a, b) => {
      const parentA = parentById.get(a.id);
      const parentB = parentById.get(b.id);
      const parentX = (id?: string) => id && positions[id] ? positions[id].x : TOPOLOGY_WIDTH / 2;
      return parentX(parentA) - parentX(parentB) || b.degree - a.degree || nodeDisplayName(a).localeCompare(nodeDisplayName(b));
    });
    if (!row.length) return;
    const y = tierY(tier, row.length);
    if (row.length > 18) {
      const columns = Math.min(18, Math.max(8, Math.ceil(Math.sqrt(row.length) * 2.2)));
      const rows = Math.ceil(row.length / columns);
      const xStep = (TOPOLOGY_WIDTH - 180) / Math.max(columns - 1, 1);
      const yStep = Math.min(86, Math.max(58, 230 / Math.max(rows, 1)));
      row.forEach((node, index) => {
        const column = index % columns;
        const subRow = Math.floor(index / columns);
        positions[node.id] = {
          x: 90 + column * xStep,
          y: clamp(y + (subRow - (rows - 1) / 2) * yStep, 65, TOPOLOGY_HEIGHT - 65),
        };
      });
      return;
    }
    const groups = groupByParent(row, parentById);
    const groupWidths = groups.map((group) => Math.max(170, (group.nodes.length - 1) * 118 + 170));
    const totalWidth = groupWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, groups.length - 1) * 76;
    let cursor = clamp((TOPOLOGY_WIDTH - totalWidth) / 2, 70, TOPOLOGY_WIDTH - totalWidth - 70);
    groups.forEach((group, groupIndex) => {
      const width = groupWidths[groupIndex];
      const parentPosition = group.parentId ? positions[group.parentId] : null;
      const groupCenter = parentPosition ? clamp(parentPosition.x, cursor + width / 2, cursor + width + 76) : cursor + width / 2;
      const start = groupCenter - ((group.nodes.length - 1) * 118) / 2;
      group.nodes.forEach((node, index) => {
        positions[node.id] = {
          x: clamp(start + index * 118, 70, TOPOLOGY_WIDTH - 70),
          y: y + staggerOffset(index, group.nodes.length),
        };
      });
      cursor += width + 76;
    });
  });

  nodes.forEach((node, index) => {
    if (!positions[node.id]) {
      const columns = Math.max(2, Math.ceil(Math.sqrt(Math.max(nodes.length, 1))));
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rows = Math.max(1, Math.ceil(nodes.length / columns));
      positions[node.id] = {
        x: 90 + column * ((TOPOLOGY_WIDTH - 180) / Math.max(columns - 1, 1)),
        y: 80 + row * ((TOPOLOGY_HEIGHT - 160) / Math.max(rows - 1, 1)),
      };
    }
  });

  nodes.forEach((node) => {
    if (manualPositions[node.id]) positions[node.id] = manualPositions[node.id];
  });

  return positions;
}

function topologyTier(node: GraphNode) {
  const text = `${node.role || ''} ${node.name || ''} ${node.status || ''}`.toLowerCase();
  if (/internet|wan|edge|gateway|router|firewall|backbone|core/.test(text) || node.degree >= 8) return 0;
  if (/distribution|dist|aggregation|agg/.test(text) || node.degree >= 5) return 1;
  if (/access|switch|wireless controller|wlc|catalyst|2960|3850|9200|9300/.test(text) || node.degree >= 2) return 2;
  if (node.managed) return 3;
  return 4;
}

function tierY(tier: number, rowLength: number) {
  const base = [125, 365, 650, 950, 1210][tier] ?? 1210;
  return clamp(base + (rowLength > 24 ? 28 : 0), 80, TOPOLOGY_HEIGHT - 80);
}

function groupByParent(nodes: GraphNode[], parentById: Map<string, string>) {
  const groups = new Map<string, { parentId: string; nodes: GraphNode[] }>();
  nodes.forEach((node) => {
    const parentId = parentById.get(node.id) || `tier-root:${node.id}`;
    const group = groups.get(parentId) || { parentId: parentId.startsWith('tier-root:') ? '' : parentId, nodes: [] };
    group.nodes.push(node);
    groups.set(parentId, group);
  });
  return Array.from(groups.values());
}

function staggerOffset(index: number, total: number) {
  if (total < 8) return 0;
  return (index % 2 === 0 ? -1 : 1) * 24;
}

function seedLayout(nodes: GraphNode[]) {
  const width = TOPOLOGY_WIDTH;
  const height = TOPOLOGY_HEIGHT;
  const centerX = width / 2;
  const centerY = height / 2;
  const positions: Record<string, { x: number; y: number }> = {};
  const sorted = [...nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  const hubCount = Math.max(1, Math.min(18, Math.ceil(Math.sqrt(Math.max(sorted.length, 1)))));
  sorted.forEach((node, index) => {
    const hub = index < hubCount;
    const ringIndex = hub ? index : index - hubCount;
    const ringSize = hub ? hubCount : Math.max(1, sorted.length - hubCount);
    const angle = (Math.PI * 2 * ringIndex) / ringSize;
    const radius = hub ? Math.max(90, 34 * hubCount) : 280 + Math.floor(ringIndex / Math.max(1, hubCount * 2)) * 115;
    positions[node.id] = {
      x: clamp(centerX + Math.cos(angle) * radius, 65, width - 65),
      y: clamp(centerY + Math.sin(angle) * radius, 45, height - 45),
    };
  });
  return positions;
}

function ipKey(value?: string | null) {
  const normalized = (value || '').trim().toLowerCase();
  return normalized ? `ip:${normalized}` : '';
}

function nameKey(value?: string | null) {
  const normalized = (value || '').trim().toLowerCase();
  return normalized ? `name:${normalized}` : '';
}

function shortHostname(value?: string | null) {
  return (value || '').split('.')[0] || '';
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function fitViewBox(graph: GraphLayout): ViewBox {
  const points = graph.nodes.map((node) => graph.positions[node.id]).filter(Boolean);
  if (!points.length) return DEFAULT_VIEWBOX;
  const minX = Math.min(...points.map((point) => point.x)) - 120;
  const maxX = Math.max(...points.map((point) => point.x)) + 120;
  const minY = Math.min(...points.map((point) => point.y)) - 90;
  const maxY = Math.max(...points.map((point) => point.y)) + 90;
  const aspect = DEFAULT_VIEWBOX.width / DEFAULT_VIEWBOX.height;
  let width = Math.max(maxX - minX, 360);
  let height = Math.max(maxY - minY, 220);
  if (width / height > aspect) {
    height = width / aspect;
  } else {
    width = height * aspect;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return clampViewBox({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  });
}

function zoomViewBox(current: ViewBox, factor: number, anchor?: { x: number; y: number }): ViewBox {
  const nextWidth = clamp(current.width * factor, 180, TOPOLOGY_WIDTH + 360);
  const nextHeight = nextWidth / (DEFAULT_VIEWBOX.width / DEFAULT_VIEWBOX.height);
  const focus = anchor || { x: current.x + current.width / 2, y: current.y + current.height / 2 };
  const ratioX = (focus.x - current.x) / current.width;
  const ratioY = (focus.y - current.y) / current.height;
  return clampViewBox({
    x: focus.x - ratioX * nextWidth,
    y: focus.y - ratioY * nextHeight,
    width: nextWidth,
    height: nextHeight,
  });
}

function clampViewBox(viewBox: ViewBox): ViewBox {
  const margin = 320;
  const minX = -margin;
  const minY = -margin;
  const maxX = TOPOLOGY_WIDTH + margin - viewBox.width;
  const maxY = TOPOLOGY_HEIGHT + margin - viewBox.height;
  return {
    ...viewBox,
    x: clamp(viewBox.x, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: clamp(viewBox.y, Math.min(minY, maxY), Math.max(minY, maxY)),
  };
}

function loadSavedLayout(): PositionMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOPOLOGY_LAYOUT_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
      return Boolean(value && typeof value === 'object' && typeof (value as { x?: unknown }).x === 'number' && typeof (value as { y?: unknown }).y === 'number');
    })) as PositionMap;
  } catch {
    return {};
  }
}

function svgPoint(svg: SVGSVGElement, event: { clientX: number; clientY: number }) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return point.matrixTransform(matrix.inverse());
}
