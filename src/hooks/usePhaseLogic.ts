/**
 * 多阶段表单逻辑 Hook
 * 复用自 root-cause-analysis / personal_review_system
 */
import { useMemo } from 'react';
import type { FormTemplate, FormRecord } from '../types';

export interface PhaseState {
  currentPhaseIndex: number;
  totalPhases: number;
  isCompleted: boolean;
  canComplete: boolean;
  phaseLabels: string[];
  phaseSectionIndices: number[][];
}

export function usePhaseLogic(
  template: FormTemplate | undefined,
  record: FormRecord | null
): PhaseState {
  return useMemo(() => {
    if (!template?.phases || template.phases.length === 0) {
      return {
        currentPhaseIndex: 0,
        totalPhases: 0,
        isCompleted: record?.status === 'completed',
        canComplete: true,
        phaseLabels: [],
        phaseSectionIndices: [],
      };
    }

    const phases = template.phases;
    const data = record?.data ?? {};

    // 计算当前阶段：找到第一个未完成的阶段
    let currentPhaseIndex = phases.length - 1;
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const allFilled = phase.completionFields.every((fieldId) => {
        const value = data[fieldId];
        if (value === undefined || value === null || value === '') return false;
        if (Array.isArray(value) && value.length === 0) return false;
        return true;
      });
      if (!allFilled) {
        currentPhaseIndex = i;
        break;
      }
    }

    // 是否可以标记完成
    const completingPhase = phases.find((p) => p.completesRecord);
    const canComplete = completingPhase
      ? completingPhase.completionFields.every((fieldId) => {
          const value = data[fieldId];
          return value !== undefined && value !== null && value !== '';
        })
      : true;

    return {
      currentPhaseIndex,
      totalPhases: phases.length,
      isCompleted: record?.status === 'completed',
      canComplete,
      phaseLabels: phases.map((p) => p.label),
      phaseSectionIndices: phases.map((p) => p.sectionIndices),
    };
  }, [template, record]);
}
