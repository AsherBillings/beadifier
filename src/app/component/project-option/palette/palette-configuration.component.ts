import { Observable } from 'rxjs';

import { Component, Input, EventEmitter, Output } from '@angular/core';
import { PaletteService } from '../../../palette/palette.service';
import { PaletteConfiguration } from '../../../model/configuration/palette-configuration.model';
import { Palette } from '../../../model/palette/palette.model';

@Component({
    selector: 'app-palette-configuration',
    templateUrl: './palette-configuration.component.html',
    styleUrls: ['./palette-configuration.component.scss'],
})
export class PaletteConfigurationComponent {
    @Input() configuration: PaletteConfiguration;
    @Output() onChange = new EventEmitter<PaletteConfiguration>();

    availablePalettes: Observable<Palette[]>;
    selectedPresets: any = {};

    constructor(public paletteService: PaletteService) {
        this.availablePalettes = paletteService.getAll();
    }

    getPresets(name: string): Observable<{ name: string; refs: string[] }[]> {
        return this.paletteService.getPresets(name);
    }

    applyPreset(palette: Palette, presetName: string) {
        if (!presetName) {
            return;
        }
        this.paletteService.getPresets(palette.name).subscribe((presets) => {
            const preset = (presets || []).find((p) => p.name === presetName);
            if (!preset) {
                return;
            }
            // If preset.refs contains '*' treat it as "select all colours"
            if ((preset.refs || []).some((r) => r === '*')) {
                palette.entries.forEach((entry) => (entry.enabled = true));
                this.callback();
                return;
            }
            palette.entries.forEach((entry) => {
                const match = (preset.refs || []).some((r) => {
                    if (!entry.ref) return false;
                    return entry.ref === r;
                });
                entry.enabled = match;
            });
            this.callback();
        });
    }

    applyPresetToSelected(presetName: string) {
        if (!presetName) {
            return;
        }
        if (!this.configuration || !this.configuration.palettes) return;
        this.configuration.palettes.forEach((p) => this.applyPreset(p, presetName));
    }

    paletteEquality(o1: Palette, o2: Palette) {
        return o1.name === o2.name;
    }

    callback() {
        this.onChange.emit(this.configuration);
    }
}
