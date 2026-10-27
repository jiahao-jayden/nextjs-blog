"use client";

import { type RefObject, useEffect } from "react";

export const STAGE_SRC = `${process.env.BASE_PATH || ""}/static/images/home/lakeside`;

type Images<K extends string> = Record<K, HTMLImageElement>;

function loadImages<K extends string>(ids: readonly K[]) {
	return Promise.all(
		ids.map(
			(id) =>
				new Promise<[K, HTMLImageElement]>((resolve, reject) => {
					const im = new Image();
					im.onload = () => resolve([id, im]);
					im.onerror = reject;
					im.src = `${STAGE_SRC}/${id}.webp`;
				}),
		),
	).then((entries) => Object.fromEntries(entries) as Images<K>);
}

/** Animates a canvas sized to its box; `draw` receives the context, loaded images and seconds elapsed. */
export function useStageCanvas<K extends string>(
	ref: RefObject<HTMLCanvasElement | null>,
	ids: readonly K[],
	draw: (c: CanvasRenderingContext2D, images: Images<K>, t: number) => void,
) {
	useEffect(() => {
		const canvas = ref.current!;
		const ctx = canvas.getContext("2d")!;
		const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let images: Images<K> | null = null;
		let disposed = false;
		let frame = 0;
		let start = 0;

		const resize = () => {
			canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
			canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
			if (images && still) draw(ctx, images, 0);
		};
		const tick = (now: number) => {
			start ||= now;
			draw(ctx, images!, (now - start) / 1000);
			frame = requestAnimationFrame(tick);
		};

		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		loadImages(ids).then((loaded) => {
			if (disposed) return;
			images = loaded;
			if (still) draw(ctx, images, 0);
			else frame = requestAnimationFrame(tick);
		});

		return () => {
			disposed = true;
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [ref, ids, draw]);
}
