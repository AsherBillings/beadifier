import * as _ from 'lodash';

import { Observable } from 'rxjs';
import { Component, ViewChild, ElementRef, HostListener } from '@angular/core';

import { PaletteService } from './palette/palette.service';
import { Project } from './model/project/project.model';
import {
    drawImageInsideCanvas,
    reduceColor,
    computeUsage,
    CropRect,
} from './utils/utils';
import { Renderer } from './renderer/renderer';
import { Canvas2dRenderer } from './renderer/2d/canvas.2d.renderer';
import { CanvasWebGLRenderer } from './renderer/webgl/canvas.webgl.renderer';

import { Scaler } from './scaler/scaler';
import { FitScreenScaler } from './scaler/fit/fit-screen.scaler';

import { MatchingConfiguration } from './model/configuration/matching-configuration.model';
import { ImageConfiguration } from './model/configuration/image-configuration.model';
import { DitheringConfiguration } from './model/configuration/dithering-configuration.model';
import { RendererConfiguration } from './model/configuration/renderer-configuration.model';
import { PaletteConfiguration } from './model/configuration/palette-configuration.model';
import { BoardConfiguration } from './model/configuration/board-configuration.model';
import { ExportConfiguration } from './model/configuration/export-configuration.model';

const BEAD_SIZE_PX = 10;

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
})
export class AppComponent {
    @ViewChild('source', { static: true }) imgTag: ElementRef;
    @ViewChild('canvasContainer', { static: true })
    canvasContainerTag: ElementRef;
    @ViewChild('preview', { static: true }) previewTag: ElementRef;
    @ViewChild('displaySource', { static: false }) displaySourceTag: ElementRef;

    availableRenderers: Renderer[];
    renderer: Renderer;
    project: Project;
    scaler: Scaler;
    aspectRatio: number;
    usage: Map<string, number>;
    reducedColor: Uint8ClampedArray;
    beadSize: number;
    loading: boolean;
    // cropping
    cropRect: CropRect;
    private dragging: {
        type: string;
        startX: number;
        startY: number;
        orig: CropRect;
    } | null;

    constructor(private paletteService: PaletteService) {
        // Rendering technology
        this.availableRenderers = [
            new CanvasWebGLRenderer(),
            new Canvas2dRenderer(),
        ];
        this.renderer = _.find(this.availableRenderers, (renderer) =>
            renderer.isSupported()
        );
        if (!this.renderer) {
            alert(
                'Sorry but your browser seems to not support required features.'
            );
        }

        // Init
        this.usage = new Map();
        this.beadSize = BEAD_SIZE_PX;
        this.scaler = new FitScreenScaler();
        this.loading = false;
        this.dragging = null;

        // Default
        paletteService.getAll().subscribe((allPalette) => {
            this.project = new Project(
                new PaletteConfiguration([allPalette[0]]),
                new BoardConfiguration(),
                new MatchingConfiguration(),
                new ImageConfiguration(),
                new DitheringConfiguration(),
                new RendererConfiguration(),
                new ExportConfiguration()
            );
        });
    }

    _beadify = _.debounce(() => {
        this.loading = true;
        new Observable((subscriber) => {
            setTimeout(() => {
                const canvasContainer = this.canvasContainerTag.nativeElement;

                // clear previous canvas if any
                while (canvasContainer.firstChild) {
                    canvasContainer.removeChild(canvasContainer.lastChild);
                }

                const canvas = document.createElement('canvas');
                canvas.width =
                    this.project.boardConfiguration.nbBoardWidth *
                    this.project.boardConfiguration.board.nbBeadPerRow;
                canvas.height =
                    this.project.boardConfiguration.nbBoardHeight *
                    this.project.boardConfiguration.board.nbBeadPerRow;

                canvasContainer.appendChild(canvas);

                const drawingPosition = drawImageInsideCanvas(
                    canvas,
                    this.imgTag.nativeElement,
                    this.project.rendererConfiguration,
                    this.cropRect
                );
                this.reducedColor = reduceColor(
                    canvas,
                    this.project,
                    drawingPosition
                ).data;
                this.usage = computeUsage(
                    this.reducedColor,
                    this.project.paletteConfiguration.palettes
                );
                this.renderer.destroy();
                this.renderer.initContainer(
                    this.previewTag.nativeElement,
                    canvas.width,
                    canvas.height,
                    BEAD_SIZE_PX
                );
                this.computeAspectRatio();
                this.renderer.render(
                    this.reducedColor,
                    canvas.width,
                    canvas.height,
                    BEAD_SIZE_PX,
                    this.project
                );
                subscriber.next();
            });
        }).subscribe(() => (this.loading = false));
    }, 250);

    beadify(project: Project) {
        if (!project.image) {
            return;
        }

        if (this.imgTag.nativeElement.src !== project.image.src) {
            this.imgTag.nativeElement.src = project.image.src;
            this.imgTag.nativeElement.addEventListener('load', () => {
                // image natural size
                this.project.srcWidth = this.imgTag.nativeElement.naturalWidth || this.imgTag.nativeElement.width;
                this.project.srcHeight = this.imgTag.nativeElement.naturalHeight || this.imgTag.nativeElement.height;
                // initialize crop to full image
                this.cropRect = {
                    sx: 0,
                    sy: 0,
                    sw: this.project.srcWidth,
                    sh: this.project.srcHeight,
                };
                this._beadify();
            });
        } else {
            this._beadify();
        }
    }

    startDrag(event: MouseEvent, type: string) {
        event.preventDefault();
        this.dragging = {
            type: type,
            startX: event.clientX,
            startY: event.clientY,
            orig: { ...this.cropRect },
        };
        window.addEventListener('mousemove', this.onMouseMoveBound);
        window.addEventListener('mouseup', this.onMouseUpBound);
    }

    private onMouseMoveBound = (ev: MouseEvent) => this.onMouseMove(ev);
    private onMouseUpBound = (ev: MouseEvent) => this.onMouseUp(ev);

    private onMouseMove(ev: MouseEvent) {
        if (!this.dragging || !this.displaySourceTag) {
            return;
        }
        const dispRect = this.displaySourceTag.nativeElement.getBoundingClientRect();
        const imgNaturalW = this.imgTag.nativeElement.naturalWidth || this.imgTag.nativeElement.width;
        const imgNaturalH = this.imgTag.nativeElement.naturalHeight || this.imgTag.nativeElement.height;

        const sxPerPx = imgNaturalW / dispRect.width;
        const syPerPx = imgNaturalH / dispRect.height;

        const dx = ev.clientX - this.dragging.startX;
        const dy = ev.clientY - this.dragging.startY;

        const sdx = dx * sxPerPx;
        const sdy = dy * syPerPx;

        const orig = this.dragging.orig;
        let nx = orig.sx;
        let ny = orig.sy;
        let nw = orig.sw;
        let nh = orig.sh;

        switch (this.dragging.type) {
            case 'move':
                nx = Math.round(orig.sx + sdx);
                ny = Math.round(orig.sy + sdy);
                break;
            case 'left':
                nx = Math.round(orig.sx + sdx);
                nw = Math.round(orig.sw - sdx);
                break;
            case 'right':
                nw = Math.round(orig.sw + sdx);
                break;
            case 'top':
                ny = Math.round(orig.sy + sdy);
                nh = Math.round(orig.sh - sdy);
                break;
            case 'bottom':
                nh = Math.round(orig.sh + sdy);
                break;
            case 'top-left':
                nx = Math.round(orig.sx + sdx);
                nw = Math.round(orig.sw - sdx);
                ny = Math.round(orig.sy + sdy);
                nh = Math.round(orig.sh - sdy);
                break;
            case 'top-right':
                nw = Math.round(orig.sw + sdx);
                ny = Math.round(orig.sy + sdy);
                nh = Math.round(orig.sh - sdy);
                break;
            case 'bottom-left':
                nx = Math.round(orig.sx + sdx);
                nw = Math.round(orig.sw - sdx);
                nh = Math.round(orig.sh + sdy);
                break;
            case 'bottom-right':
                nw = Math.round(orig.sw + sdx);
                nh = Math.round(orig.sh + sdy);
                break;
        }

        // clamp: for moves, only clamp position (do not change size)
        if (this.dragging && this.dragging.type === 'move') {
            if (nx < 0) nx = 0;
            if (ny < 0) ny = 0;
            if (nx + nw > imgNaturalW) nx = imgNaturalW - nw;
            if (ny + nh > imgNaturalH) ny = imgNaturalH - nh;
        } else {
            // resizing: clamp edges to image bounds while preserving the opposite edge
            if (nx < 0) {
                const right = nx + nw;
                nx = 0;
                nw = Math.round(right - nx);
            }
            if (ny < 0) {
                const bottom = ny + nh;
                ny = 0;
                nh = Math.round(bottom - ny);
            }
            if (nx + nw > imgNaturalW) {
                nw = imgNaturalW - nx;
            }
            if (ny + nh > imgNaturalH) {
                nh = imgNaturalH - ny;
            }
        }
        if (nw < 1) nw = 1;
        if (nh < 1) nh = 1;

        this.cropRect = { sx: nx, sy: ny, sw: nw, sh: nh };
    }

    private onMouseUp(_ev: MouseEvent) {
        if (this.dragging) {
            this.dragging = null;
            window.removeEventListener('mousemove', this.onMouseMoveBound);
            window.removeEventListener('mouseup', this.onMouseUpBound);
            // re-run beadify with new crop
            this._beadify();
        }
    }

    cropLeft(): string {
        if (!this.displaySourceTag || !this.cropRect) return '0px';
        const r = this.displaySourceTag.nativeElement.getBoundingClientRect();
        const x = (this.cropRect.sx / (this.imgTag.nativeElement.naturalWidth || this.imgTag.nativeElement.width)) * r.width;
        return Math.round(x) + 'px';
    }

    cropTop(): string {
        if (!this.displaySourceTag || !this.cropRect) return '0px';
        const r = this.displaySourceTag.nativeElement.getBoundingClientRect();
        const y = (this.cropRect.sy / (this.imgTag.nativeElement.naturalHeight || this.imgTag.nativeElement.height)) * r.height;
        return Math.round(y) + 'px';
    }

    cropWidth(): string {
        if (!this.displaySourceTag || !this.cropRect) return '0px';
        const r = this.displaySourceTag.nativeElement.getBoundingClientRect();
        const w = (this.cropRect.sw / (this.imgTag.nativeElement.naturalWidth || this.imgTag.nativeElement.width)) * r.width;
        return Math.round(w) + 'px';
    }

    cropHeight(): string {
        if (!this.displaySourceTag || !this.cropRect) return '0px';
        const r = this.displaySourceTag.nativeElement.getBoundingClientRect();
        const h = (this.cropRect.sh / (this.imgTag.nativeElement.naturalHeight || this.imgTag.nativeElement.height)) * r.height;
        return Math.round(h) + 'px';
    }

    @HostListener('window:resize', ['$event'])
    computeAspectRatio() {
        this.aspectRatio = this.scaler.compute(
            this.project,
            this.previewTag.nativeElement.parentElement.clientWidth,
            this.previewTag.nativeElement.parentElement.clientHeight,
            BEAD_SIZE_PX
        );
    }
}
