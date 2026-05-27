"use client";

import { useEffect, useRef, useState } from "react";
import { findNearest, fmtDistance, haversineMeters } from "./geo";

// Movement gate: don't recompute nearest unless the user moved more than this.
const MOVE_GATE_M = 10;
// Low-pass smoothing factor for the heading (0..1, higher = snappier/jitterier).
const HEADING_SMOOTH = 0.15;

// Cheeky proximity copy keyed to distance (meters).
function vibe(m) {
  if (m == null) return "Locking on…";
  if (m < 15) return "You've arrived. 🍻";
  if (m < 40) return "Smell that?";
  if (m < 120) return "Nearly there.";
  if (m < 400) return "Getting warmer.";
  if (m < 1500) return "A short pilgrimage.";
  return "Stay strong, soldier.";
}

export default function Compass() {
  const [shops, setShops] = useState([]);
  const [pos, setPos] = useState(null); // { lat, lng, accuracy }
  const [heading, setHeading] = useState(null); // smoothed device heading, degrees
  const [nearest, setNearest] = useState(null);
  const [status, setStatus] = useState("Loading shops…");
  const [needsTap, setNeedsTap] = useState(false);

  const lastCalcPos = useRef(null);
  const smoothedHeading = useRef(null);
  const buzzedRef = useRef(false);

  // Load the GeoJSON once.
  useEffect(() => {
    fetch("/shops.geojson")
      .then((r) => r.json())
      .then((g) => {
        setShops(g.features || []);
        setStatus(g.features?.length ? "" : "No shops mapped yet.");
      })
      .catch(() => setStatus("Couldn't load shops.geojson"));
  }, []);

  // Geolocation watch.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation not supported on this device.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setPos({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (err) => setStatus(`Location error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Recompute nearest only when we've moved past the gate.
  useEffect(() => {
    if (!pos || shops.length === 0) return;
    const prev = lastCalcPos.current;
    const moved =
      !prev || haversineMeters(prev.lat, prev.lng, pos.lat, pos.lng) > MOVE_GATE_M;
    if (moved) {
      lastCalcPos.current = pos;
      setNearest(findNearest(pos.lat, pos.lng, shops));
    } else if (nearest) {
      const [flng, flat] = nearest.feature.geometry.coordinates;
      setNearest((n) => ({
        ...n,
        distance: haversineMeters(pos.lat, pos.lng, flat, flng),
      }));
    }
  }, [pos, shops]); // eslint-disable-line react-hooks/exhaustive-deps

  // Haptic buzz once when you cross into "arrived" range.
  useEffect(() => {
    if (!nearest) return;
    if (nearest.distance < 15 && !buzzedRef.current) {
      buzzedRef.current = true;
      navigator.vibrate?.([40, 30, 40]);
    } else if (nearest.distance >= 25) {
      buzzedRef.current = false;
    }
  }, [nearest]);

  function handleOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === "number") {
      h = e.webkitCompassHeading;
    } else if (e.absolute && typeof e.alpha === "number") {
      h = (360 - e.alpha) % 360;
    }
    if (h == null) return;
    const s = smoothedHeading.current;
    smoothedHeading.current =
      s == null ? h : s + HEADING_SMOOTH * (((h - s + 540) % 360) - 180);
    setHeading((smoothedHeading.current + 360) % 360);
  }

  function startOrientation() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      DOE.requestPermission().then((res) => {
        if (res === "granted") {
          window.addEventListener("deviceorientation", handleOrientation, true);
          setNeedsTap(false);
        } else {
          setStatus("Compass permission denied.");
        }
      });
    } else {
      window.addEventListener("deviceorientationabsolute", handleOrientation, true);
      window.addEventListener("deviceorientation", handleOrientation, true);
      setNeedsTap(false);
    }
  }

  useEffect(() => {
    const DOE =
      typeof window !== "undefined" ? window.DeviceOrientationEvent : null;
    if (DOE && typeof DOE.requestPermission === "function") {
      setNeedsTap(true);
    } else {
      startOrientation();
    }
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      window.removeEventListener("deviceorientationabsolute", handleOrientation, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dial counter-rotates to device heading (so N tick tracks real north);
  // needle points to the shop's true bearing within that rotated dial.
  const dialRot = heading != null ? -heading : 0;
  const needleRot = nearest ? nearest.bearing : 0;
  const live = nearest && heading != null;
  const dist = nearest?.distance;

  return (
    <main className="screen">
      <div className="glow" />
      <header className="masthead">
        <span className="brand">PYAASA</span>
        <span className="tagline">a compass for the thirsty</span>
      </header>

      {needsTap && (
        <button className="enable" onClick={startOrientation}>
          Tap to wake the compass
        </button>
      )}

      <div className={`dial-wrap ${dist != null && dist < 40 ? "close" : ""}`}>
        <div className="dial" style={{ transform: `rotate(${dialRot}deg)` }}>
          <div className="ticks">
            {Array.from({ length: 72 }).map((_, i) => (
              <span
                key={i}
                className={`tick ${i % 9 === 0 ? "major" : ""}`}
                style={{ transform: `rotate(${i * 5}deg) translateY(-92px)` }}
              />
            ))}
          </div>
          <span className="cardinal n">N</span>
          <span className="cardinal e">E</span>
          <span className="cardinal s">S</span>
          <span className="cardinal w">W</span>
          {/* needle rotates within the (already heading-rotated) dial */}
          <div
            className="needle"
            style={{
              transform: `rotate(${needleRot}deg)`,
              opacity: live ? 1 : 0.3,
            }}
          >
            <span className="bottle" aria-hidden>🍾</span>
          </div>
          <span className="hub" />
        </div>
      </div>

      <div className="readout">
        <div className="distance">{dist != null ? fmtDistance(dist) : "—"}</div>
        <div className="vibe">{nearest ? vibe(dist) : status || "Finding you…"}</div>
        {nearest && <div className="shopname">{nearest.feature.properties.name}</div>}
      </div>

      <div className="stats">
        <div className="stat">
          <span className="k">HEADING</span>
          <span className="v">{heading != null ? `${Math.round(heading)}°` : "—"}</span>
        </div>
        <div className="stat">
          <span className="k">BEARING</span>
          <span className="v">{nearest ? `${Math.round(nearest.bearing)}°` : "—"}</span>
        </div>
        <div className="stat">
          <span className="k">GPS</span>
          <span className="v">{pos ? `±${Math.round(pos.accuracy)}m` : "—"}</span>
        </div>
      </div>

      {heading == null && !needsTap && nearest && (
        <p className="hint">Wave your phone in a figure-8 to calibrate.</p>
      )}
    </main>
  );
}
