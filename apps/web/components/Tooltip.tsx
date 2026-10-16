'use client';
import React, { type ReactNode } from 'react';
import {
  Tooltip as UITooltip,
  TooltipArrow,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * First-party Tooltip — LOGIC ONLY (spec G2).
 * Radix/shadcn owns behaviour & structure; the white-card look from the legacy
 * tooltip lives in styles/components/tooltip.css via the `.tooltip-content` hook.
 */
const Tooltip = ({ children, tooltipText }: { children: ReactNode; tooltipText: string }) => {
  return (
    <TooltipProvider delayDuration={150}>
      <UITooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="tooltip-content" sideOffset={6}>
          {tooltipText}
          <TooltipArrow className="tooltip-arrow" />
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  );
};

export default Tooltip;
