import { motion } from "motion/react";
import { useEffect, useId, useState } from "react";

import type { RefObject } from "react";

export interface AnimatedBeamProps {
  className?: string;
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  pathDasharray?: string;
  gradientStartColor?: string;
  gradientStopColor?: string;
  delay?: number;
  duration?: number;
  startXOffset?: number;
  startYOffset?: number;
  endXOffset?: number;
  endYOffset?: number;
  active?: boolean;
}

export function AnimatedBeam({
  className = "",
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 3.2,
  delay = 0,
  pathColor = "currentColor",
  pathWidth = 2.5,
  pathOpacity = 0.22,
  pathDasharray,
  gradientStartColor = "var(--color-signal)",
  gradientStopColor = "var(--color-signal-text)",
  startXOffset = 0,
  startYOffset = 0,
  endXOffset = 0,
  endYOffset = 0,
  active = true,
}: AnimatedBeamProps) {
  const id = useId();
  const [pathD, setPathD] = useState("");
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
  const [isVertical, setIsVertical] = useState(false);

  useEffect(() => {
    const updatePath = () => {
      const container = containerRef.current;
      const fromEl = fromRef.current;
      const toEl = toRef.current;

      if (container === null || fromEl === null || toEl === null) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const rectA = fromEl.getBoundingClientRect();
      const rectB = toEl.getBoundingClientRect();

      setSvgDimensions({
        width: Math.max(1, Math.round(containerRect.width)),
        height: Math.max(1, Math.round(containerRect.height)),
      });

      const startX = rectA.left - containerRect.left + rectA.width / 2 + startXOffset;
      const startY = rectA.top - containerRect.top + rectA.height / 2 + startYOffset;
      const endX = rectB.left - containerRect.left + rectB.width / 2 + endXOffset;
      const endY = rectB.top - containerRect.top + rectB.height / 2 + endYOffset;

      setIsVertical(Math.abs(endY - startY) > Math.abs(endX - startX) * 1.4);

      const controlX = (startX + endX) / 2;
      const controlY = (startY + endY) / 2 - curvature;

      setPathD(
        `M ${String(startX)},${String(startY)} Q ${String(controlX)},${String(controlY)} ${String(endX)},${String(endY)}`,
      );
    };

    const resizeObserver = new ResizeObserver(() => {
      updatePath();
    });

    if (containerRef.current !== null) {
      resizeObserver.observe(containerRef.current);
    }

    updatePath();

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, fromRef, toRef, curvature, startXOffset, startYOffset, endXOffset, endYOffset]);

  let gradientCoords = {
    x1: ["10%", "110%"],
    x2: ["0%", "100%"],
    y1: ["0%", "0%"],
    y2: ["0%", "0%"],
  };

  if (isVertical) {
    gradientCoords = reverse
      ? {
          x1: ["0%", "0%"],
          x2: ["0%", "0%"],
          y1: ["90%", "-10%"],
          y2: ["100%", "0%"],
        }
      : {
          x1: ["0%", "0%"],
          x2: ["0%", "0%"],
          y1: ["10%", "110%"],
          y2: ["0%", "100%"],
        };
  } else if (reverse) {
    gradientCoords = {
      x1: ["90%", "-10%"],
      x2: ["100%", "0%"],
      y1: ["0%", "0%"],
      y2: ["0%", "0%"],
    };
  }

  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none absolute left-0 top-0 transform-gpu ${className}`}
      fill="none"
      height={svgDimensions.height}
      viewBox={`0 0 ${String(svgDimensions.width)} ${String(svgDimensions.height)}`}
      width={svgDimensions.width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={pathD}
        stroke={pathColor}
        strokeDasharray={pathDasharray}
        strokeLinecap="round"
        strokeOpacity={pathOpacity}
        strokeWidth={pathWidth}
      />
      {active ? (
        <path
          d={pathD}
          stroke={`url(#${id})`}
          strokeLinecap="round"
          strokeOpacity="1"
          strokeWidth={pathWidth + 1.2}
        />
      ) : null}
      <defs>
        <motion.linearGradient
          animate={gradientCoords}
          className="transform-gpu"
          gradientUnits="userSpaceOnUse"
          id={id}
          initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }}
          transition={{
            delay,
            duration,
            ease: [0.16, 1, 0.3, 1],
            repeat: Number.POSITIVE_INFINITY,
            repeatDelay: 0.4,
          }}
        >
          <stop stopColor={gradientStartColor} stopOpacity="0" />
          <stop stopColor={gradientStartColor} />
          <stop offset="35%" stopColor={gradientStopColor} />
          <stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </svg>
  );
}
