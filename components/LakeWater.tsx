"use client";

import { useRef } from "react";
import { useStageCanvas } from "./useStageCanvas";

// Pixel space of the 2046×1152 extended background.
const W = 2046;
const H = 1152;
const LAKE_TOP = 634;
const ROW = 3;
const IMAGES = ["background-wide", "water-mask"] as const;
type Images = Record<(typeof IMAGES)[number], HTMLImageElement>;

// Lake surface: background rows shifted by a travelling sine wave, drifting highlight strokes on top
// (after Lakeside Studio runtime.js), all clipped to the lake mask. Nearer water moves more.
function draw(c: CanvasRenderingContext2D, img: Images, t: number) {
	const k = c.canvas.width / W;
	c.setTransform(1, 0, 0, 1, 0, 0);
	c.clearRect(0, 0, c.canvas.width, c.canvas.height);
	c.setTransform(k, 0, 0, k, 0, 0);

	const bg = img["background-wide"];
	const sx = bg.naturalWidth / W;
	const sy = bg.naturalHeight / H;
	for (let y = LAKE_TOP; y < H; y += ROW) {
		const depth = (y - LAKE_TOP) / (H - LAKE_TOP);
		const dx = Math.sin(y * 0.085 - t * 1.6) * (0.6 + depth * 2.6);
		c.drawImage(bg, 0, y * sy, bg.naturalWidth, ROW * sy, dx, y, W, ROW + 0.5);
	}

	c.lineCap = "round";
	for (let i = 0; i < 240; i++) {
		const y0 = LAKE_TOP + ((i * 47.37) % (H - LAKE_TOP));
		const depth = (y0 - LAKE_TOP) / (H - LAKE_TOP);
		const x = ((i * 137.43 + t * (10 + depth * 24)) % (W + 120)) - 60;
		const y = y0 + Math.sin(t * 1.3 + i) * 1.5;
		const len = (19 + (i % 14)) * (0.7 + depth * 0.9);
		c.lineWidth = 1 + depth * 1.3;
		c.strokeStyle = `rgba(240,250,242,${0.16 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.9 + i))})`;
		c.beginPath();
		c.moveTo(x, y);
		c.quadraticCurveTo(x + len / 2, y - 2, x + len, y);
		c.stroke();
	}

	c.globalCompositeOperation = "destination-in";
	c.drawImage(img["water-mask"], 0, 0, W, H);
	c.globalCompositeOperation = "source-over";
}

export default function LakeWater({ className }: { className?: string }) {
	const ref = useRef<HTMLCanvasElement>(null);

	useStageCanvas(ref, IMAGES, draw);

	return <canvas ref={ref} className={className} aria-hidden="true" />;
}
