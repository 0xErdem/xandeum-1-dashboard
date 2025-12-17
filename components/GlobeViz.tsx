'use client';

import { useEffect, useRef, useState } from 'react';
import Globe from 'react-globe.gl';

interface GlobeVizProps {
  nodes: any[];
  onNodeClick: (node: any) => void;
}

export default function GlobeViz({ nodes, onNodeClick }: GlobeVizProps) {
  const globeEl = useRef<any>();
  const [mounted, setMounted] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    }
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (globeEl.current) {
      globeEl.current.controls().autoRotate = true;
      globeEl.current.controls().autoRotateSpeed = 0.5;
      globeEl.current.pointOfView({ altitude: 2.0 }, 1000);
    }
  }, [mounted]);

  if (!mounted) return null;

  return (
    <Globe
      ref={globeEl}
      width={dimensions.width}
      height={dimensions.height}
      
      // GÖRÜNTÜ KALİTESİ
      rendererConfig={{ antialias: true, alpha: true }}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
      backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
      
      // ATMOSFER (Hafif Glow)
      atmosphereColor="#3a86ff"
      atmosphereAltitude={0.12}

      // NODE AYARLARI (Tıklama için kritik: pointsMerge=false)
      pointsData={nodes}
      pointLat="lat"
      pointLng="lng"
      pointColor={(node: any) => node.isValidator ? '#00ff88' : '#0099ff'} 
      pointAltitude={0.1} // Yüzeyden biraz yukarıda
      pointRadius={0.6}   // Tıklaması kolay olsun diye büyük
      pointsMerge={false} // ÖNEMLİ: Tıklama hassasiyetini artırır
      
      // HALKALAR (Görsel Şölen)
      ringsData={nodes}
      ringColor={() => '#06b6d4'}
      ringMaxRadius={2}
      ringPropagationSpeed={3}
      ringRepeatPeriod={800}

      // TIKLAMA OLAYI
      onPointClick={(node: any) => {
        globeEl.current.pointOfView({ lat: node.lat, lng: node.lng, altitude: 1.5 }, 1000);
        onNodeClick(node);
      }}

      // TOOLTIP
      pointLabel={(node: any) => `
        <div style="background: rgba(0,0,0,0.8); color: white; padding: 4px 8px; border-radius: 4px; font-family: sans-serif; font-size: 12px; border: 1px solid #06b6d4;">
          ${node.city || 'Unknown'} (${node.isValidator ? 'Validator' : 'RPC'})
        </div>
      `}
    />
  );
}