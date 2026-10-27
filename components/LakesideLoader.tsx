"use client";

import { useEffect, useRef, useState } from "react";
import siteMetadata from "@/data/siteMetadata";

function ready(el: HTMLImageElement | HTMLVideoElement) {
	return new Promise<void>((resolve) => {
		if (el instanceof HTMLImageElement) {
			if (el.complete) return resolve();
			el.addEventListener("load", () => resolve(), { once: true });
			el.addEventListener("error", () => resolve(), { once: true });
			return;
		}
		// An idle network state or `suspend` means the browser stopped fetching before playback, e.g. iOS Low Power Mode.
		if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || el.networkState === HTMLMediaElement.NETWORK_IDLE)
			return resolve();
		for (const type of ["loadeddata", "error", "suspend"]) el.addEventListener(type, () => resolve(), { once: true });
	});
}

/** Covers its parent until every image and video inside it can be shown, reporting progress per unique file. */
export default function LakesideLoader() {
	const ref = useRef<HTMLDivElement>(null);
	const [progress, setProgress] = useState(0);
	const [done, setDone] = useState(false);
	const [gone, setGone] = useState(false);

	useEffect(() => {
		const root = ref.current!.parentElement!;
		const byUrl = new Map<string, Promise<void>>();
		for (const el of root.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video")) {
			const url = el instanceof HTMLImageElement ? el.currentSrc || el.src : el.currentSrc || el.querySelector("source")!.src;
			if (!byUrl.has(url)) byUrl.set(url, ready(el));
		}
		let loaded = 0;
		let disposed = false;
		const total = byUrl.size;
		for (const p of byUrl.values())
			p.then(() => {
				if (disposed) return;
				loaded++;
				setProgress(loaded / total);
				if (loaded === total) setDone(true);
			});
		return () => {
			disposed = true;
		};
	}, []);

	if (gone) return null;
	return (
		<div
			ref={ref}
			role="progressbar"
			aria-label="Loading scene"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress * 100)}
			onTransitionEnd={(e) => done && e.target === e.currentTarget && setGone(true)}
			className={`bg-vellum fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 transition-opacity duration-700 ${done ? "pointer-events-none opacity-0" : ""}`}
		>
			<span className="text-charcoal font-serif text-lg">{siteMetadata.headerTitle}</span>
			<div className="bg-divider h-px w-48 overflow-hidden">
				<div
					className="bg-charcoal h-full origin-left transition-transform duration-300 ease-out"
					style={{ transform: `scaleX(${progress})` }}
				/>
			</div>
			<span className="text-muted text-xs tabular-nums">{Math.round(progress * 100)}%</span>
		</div>
	);
}
