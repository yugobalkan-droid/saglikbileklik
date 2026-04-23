import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import BottomSheet from '../components/BottomSheet';
import { usePatient } from '../context/PatientContext';
import { upsertSlot, deleteSlot } from '../services/scheduleService';

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const PERIODS = ['Sabah', 'Öğle', 'Akşam'];
const PERIOD_ICONS = ['sunny-outline', 'partly-sunny-outline', 'moon-outline'];
const PERIOD_TIMES = ['08:00', '14:00', '20:00'];

export default function ScheduleScreen() {
  const { patientId, scheduleGrid } = usePatient();
  const [selectedCell, setSelectedCell] = useState(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [medName, setMedName] = useState('');
  const [medTime, setMedTime] = useState('');

  const today = new Date().getDay();
  const todayIndex = today === 0 ? 6 : today - 1;

  const handleCellPress = (periodIdx, dayIdx) => {
    const cellData = scheduleGrid[periodIdx]?.[dayIdx];
    setSelectedCell({ period: periodIdx, day: dayIdx, data: cellData });
    setMedName(cellData?.name || '');
    setMedTime(cellData?.time || PERIOD_TIMES[periodIdx]);
    setSheetVisible(true);
  };

  const handleSave = async () => {
    if (!patientId) {
      Alert.alert('Hata', 'Lütfen önce Ayarlar sekmesinden bir hasta ekleyin.');
      return;
    }
    if (!medName.trim()) {
      Alert.alert('Hata', 'İlaç adı gereklidir.');
      return;
    }

    try {
      await upsertSlot(patientId, {
        period: selectedCell.period,
        day: selectedCell.day,
        medicationName: medName.trim(),
        time: (medTime || PERIOD_TIMES[selectedCell.period]).trim(),
      });
      closeSheet();
    } catch (error) {
      Alert.alert('Hata', 'Kayıt sırasında hata oluştu: ' + error.message);
    }
  };

  const handleDelete = async () => {
    if (!patientId) return;
    try {
      await deleteSlot(patientId, selectedCell.period, selectedCell.day);
      closeSheet();
    } catch (error) {
      Alert.alert('Hata', 'Silme sırasında hata oluştu: ' + error.message);
    }
  };

  const closeSheet = () => {
    setSheetVisible(false);
    setSelectedCell(null);
  };

  // Canlı renk paleti - periyoda göre
  const PERIOD_COLORS = [
    { bg: '#FFF3E0', bgFilled: '#FFE0B2', accent: '#E65100', icon: '#FF6D00', border: '#FFB74D', gradient: '#FFA726' },  // Sabah - Turuncu/Altın
    { bg: '#E3F2FD', bgFilled: '#BBDEFB', accent: '#0D47A1', icon: '#1565C0', border: '#64B5F6', gradient: '#42A5F5' },  // Öğle - Mavi
    { bg: '#F3E5F5', bgFilled: '#E1BEE7', accent: '#4A148C', icon: '#7B1FA2', border: '#BA68C8', gradient: '#AB47BC' },  // Akşam - Mor
  ];

  const getCellColor = (periodIdx, dayIdx) => {
    const data = scheduleGrid[periodIdx]?.[dayIdx];
    const pc = PERIOD_COLORS[periodIdx];
    if (!data) return pc.bg;
    return pc.bgFilled;
  };

  const getCellAccent = (periodIdx) => {
    return PERIOD_COLORS[periodIdx].accent;
  };

  const getCellBorder = (periodIdx) => {
    return PERIOD_COLORS[periodIdx].border;
  };

  const getCellGradient = (periodIdx) => {
    return PERIOD_COLORS[periodIdx].gradient;
  };

  const compartmentNumber = (periodIdx, dayIdx) => periodIdx * 7 + dayIdx + 1;

  // Dolu/Boş bölme sayısı
  const filledCount = Object.values(scheduleGrid).reduce(
    (sum, period) => sum + Object.keys(period).length, 0
  );
  const emptyCount = 21 - filledCount;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>İlaç Planı</Text>
          <Text style={styles.subtitle}>21 Bölmeli Haftalık Program</Text>
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: PERIOD_COLORS[0].gradient }]} />
            <Text style={styles.legendText}>Sabah</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: PERIOD_COLORS[1].gradient }]} />
            <Text style={styles.legendText}>Öğle</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: PERIOD_COLORS[2].gradient }]} />
            <Text style={styles.legendText}>Akşam</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.primaryLight }]} />
            <Text style={styles.legendText}>Bugün</Text>
          </View>
        </View>

        {/* Day Headers */}
        <View style={styles.dayHeaderRow}>
          <View style={styles.periodLabelSpace} />
          {DAYS.map((day, idx) => (
            <View
              key={day}
              style={[styles.dayHeader, idx === todayIndex && styles.todayDayHeader]}
            >
              <Text style={[styles.dayText, idx === todayIndex && styles.todayDayText]}>
                {day}
              </Text>
            </View>
          ))}
        </View>

        {/* Grid Rows */}
        {PERIODS.map((period, periodIdx) => (
          <View key={period} style={styles.gridRow}>
            <View style={[styles.periodLabel, { backgroundColor: PERIOD_COLORS[periodIdx].bg }]}>
              <Ionicons name={PERIOD_ICONS[periodIdx]} size={18} color={PERIOD_COLORS[periodIdx].gradient} />
              <Text style={[styles.periodText, { color: PERIOD_COLORS[periodIdx].accent }]}>{period}</Text>
              <Text style={[styles.periodTime, { color: PERIOD_COLORS[periodIdx].gradient }]}>{PERIOD_TIMES[periodIdx]}</Text>
            </View>

            {DAYS.map((day, dayIdx) => {
              const cellData = scheduleGrid[periodIdx]?.[dayIdx];
              const isToday = dayIdx === todayIndex;
              const hasMed = !!cellData;
              const pc = PERIOD_COLORS[periodIdx];

              return (
                <TouchableOpacity
                  key={`${periodIdx}-${dayIdx}`}
                  style={[
                    styles.cell,
                    { backgroundColor: getCellColor(periodIdx, dayIdx) },
                    hasMed && { borderLeftWidth: 3, borderLeftColor: pc.gradient },
                    isToday && [styles.todayCell, { borderColor: pc.gradient }],
                    !hasMed && styles.emptyCell,
                  ]}
                  onPress={() => handleCellPress(periodIdx, dayIdx)}
                  activeOpacity={0.7}
                >
                  {hasMed ? (
                    <>
                      <View style={[styles.cellIconBadge, { backgroundColor: pc.gradient }]}>
                        <Ionicons name="medical" size={10} color="#fff" />
                      </View>
                      <Text style={[styles.cellMedName, { color: pc.accent }]} numberOfLines={2}>
                        {cellData.name}
                      </Text>
                      <Text style={[styles.cellCompartment, { color: pc.gradient }]}>
                        B{compartmentNumber(periodIdx, dayIdx)}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="add-circle-outline" size={16} color={pc.border} />
                      <Text style={[styles.cellEmptyLabel, { color: pc.border }]}>Ekle</Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {/* Physical Box Stats */}
        <View style={styles.physicalBox}>
          <View style={styles.physicalBoxHeader}>
            <View style={styles.physicalBoxIconWrap}>
              <Ionicons name="cube" size={22} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.physicalBoxTitle}>Fiziksel Kutu</Text>
              <Text style={styles.physicalBoxSubtitle}>21 Bölme (3×7)</Text>
            </View>
          </View>
          <View style={styles.physicalBoxStats}>
            <View style={[styles.physicalBoxStat, { backgroundColor: colors.successSurface }]}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={[styles.physicalBoxStatValue, { color: colors.success }]}>{filledCount}</Text>
              <Text style={styles.physicalBoxStatLabel}>Dolu</Text>
            </View>
            <View style={[styles.physicalBoxStat, { backgroundColor: colors.warningSurface }]}>
              <Ionicons name="ellipse-outline" size={20} color={colors.warning} />
              <Text style={[styles.physicalBoxStatValue, { color: '#F57C00' }]}>{emptyCount}</Text>
              <Text style={styles.physicalBoxStatLabel}>Boş</Text>
            </View>
            <View style={[styles.physicalBoxStat, { backgroundColor: colors.primarySurface }]}>
              <Ionicons name="grid" size={20} color={colors.primary} />
              <Text style={[styles.physicalBoxStatValue, { color: colors.primary }]}>21</Text>
              <Text style={styles.physicalBoxStatLabel}>Toplam</Text>
            </View>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${(filledCount / 21) * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>%{Math.round((filledCount / 21) * 100)} dolu</Text>
        </View>
      </ScrollView>

      {/* Bottom Sheet */}
      <BottomSheet
        visible={sheetVisible}
        onClose={closeSheet}
        title={selectedCell ? `${PERIODS[selectedCell.period]} - ${DAYS[selectedCell.day]}` : ''}
      >
        {selectedCell && (
          <View style={styles.sheetBody}>
            <View style={styles.compartmentBadge}>
              <Ionicons name="cube" size={18} color={colors.primary} />
              <Text style={styles.compartmentText}>
                Bölme {compartmentNumber(selectedCell.period, selectedCell.day)}
              </Text>
            </View>

            <Text style={styles.inputLabel}>İlaç Adı</Text>
            <TextInput
              style={styles.input}
              value={medName}
              onChangeText={setMedName}
              placeholder="Örn: Donepezil 10mg"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={styles.inputLabel}>Saat</Text>
            <TextInput
              style={styles.input}
              value={medTime}
              onChangeText={setMedTime}
              placeholder="Örn: 08:00"
              placeholderTextColor={colors.textTertiary}
            />

            <Pressable style={styles.saveBtn} onPress={handleSave}>
              <Ionicons name="checkmark" size={20} color={colors.textOnPrimary} />
              <Text style={styles.saveBtnText}>Kaydet</Text>
            </Pressable>

            {selectedCell.data && (
              <Pressable style={styles.removeBtn} onPress={handleDelete}>
                <Ionicons name="trash-outline" size={20} color={colors.accent} />
                <Text style={styles.removeBtnText}>Bölmeyi Boşalt</Text>
              </Pressable>
            )}
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'android' ? spacing.xxxxl + 8 : spacing.xxxl,
    paddingBottom: 100,
  },
  header: { marginBottom: spacing.xl },
  title: { ...typography.headlineLarge, color: colors.textPrimary },
  subtitle: { ...typography.bodyMedium, color: colors.textSecondary, marginTop: spacing.xs },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.xl },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { ...typography.labelSmall, color: colors.textSecondary },
  dayHeaderRow: { flexDirection: 'row', marginBottom: spacing.sm },
  periodLabelSpace: { width: 60 },
  dayHeader: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: borderRadius.sm, marginHorizontal: 2 },
  todayDayHeader: { backgroundColor: colors.primary },
  dayText: { ...typography.labelMedium, color: colors.textSecondary, fontWeight: '500' },
  todayDayText: { color: colors.textOnPrimary, fontWeight: '700' },
  gridRow: { flexDirection: 'row', marginBottom: spacing.md },
  periodLabel: { width: 60, justifyContent: 'center', alignItems: 'center', gap: 2, borderRadius: borderRadius.sm, paddingVertical: spacing.xs, marginRight: 2 },
  periodText: { ...typography.labelSmall, fontWeight: '700' },
  periodTime: { fontSize: 9, fontWeight: '500' },
  cell: { flex: 1, minHeight: 68, borderRadius: borderRadius.md, justifyContent: 'center', alignItems: 'center', marginHorizontal: 2, paddingVertical: spacing.xs, paddingHorizontal: 2 },
  todayCell: { borderWidth: 2.5 },
  emptyCell: { opacity: 0.55, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  cellIconBadge: { width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  cellMedName: { fontSize: 8, fontWeight: '700', textAlign: 'center', lineHeight: 10 },
  cellCompartment: { fontSize: 8, fontWeight: '600', marginTop: 1 },
  cellEmptyLabel: { fontSize: 8, fontWeight: '500', marginTop: 2 },
  physicalBox: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.xl, marginTop: spacing.xl, ...shadows.md },
  physicalBoxHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  physicalBoxIconWrap: { width: 44, height: 44, borderRadius: borderRadius.md, backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center' },
  physicalBoxTitle: { ...typography.titleLarge, color: colors.textPrimary },
  physicalBoxSubtitle: { ...typography.bodySmall, color: colors.textSecondary },
  physicalBoxStats: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  physicalBoxStat: { flex: 1, alignItems: 'center', borderRadius: borderRadius.md, paddingVertical: spacing.md, gap: spacing.xs },
  physicalBoxStatValue: { ...typography.headlineMedium },
  physicalBoxStatLabel: { ...typography.labelSmall, color: colors.textSecondary },
  progressBarBg: { height: 8, backgroundColor: colors.surfaceVariant, borderRadius: 4, overflow: 'hidden', marginBottom: spacing.xs },
  progressBarFill: { height: '100%', backgroundColor: colors.success, borderRadius: 4 },
  progressText: { ...typography.labelSmall, color: colors.textSecondary, textAlign: 'right' },
  sheetBody: { paddingBottom: spacing.xl },
  compartmentBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySurface, alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.full, gap: spacing.xs, marginBottom: spacing.xl },
  compartmentText: { ...typography.labelMedium, color: colors.primary, fontWeight: '600' },
  inputLabel: { ...typography.labelLarge, color: colors.textPrimary, marginBottom: spacing.sm },
  input: { backgroundColor: colors.surfaceVariant, borderRadius: borderRadius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, ...typography.bodyLarge, color: colors.textPrimary, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, paddingVertical: spacing.lg, borderRadius: borderRadius.md, gap: spacing.sm, ...shadows.md },
  saveBtnText: { ...typography.titleMedium, color: colors.textOnPrimary },
  removeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, marginTop: spacing.md, gap: spacing.sm },
  removeBtnText: { ...typography.titleMedium, color: colors.accent },
});
