import React from 'react';

export const Svg = (props: Record<string, unknown>) => React.createElement('svg', props);
export const Path = (props: Record<string, unknown>) => React.createElement('path', props);
export const Circle = (props: Record<string, unknown>) => React.createElement('circle', props);
export const Rect = (props: Record<string, unknown>) => React.createElement('rect', props);
export const Line = (props: Record<string, unknown>) => React.createElement('line', props);
export const Polyline = (props: Record<string, unknown>) => React.createElement('polyline', props);
export const Polygon = (props: Record<string, unknown>) => React.createElement('polygon', props);
export const G = (props: Record<string, unknown>) => React.createElement('g', props);
export const Text = (props: Record<string, unknown>) => React.createElement('text', props);
export const TSpan = (props: Record<string, unknown>) => React.createElement('tspan', props);
export default Svg;
