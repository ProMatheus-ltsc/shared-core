/**
 * 表单Tab导航组件
 */

interface FormTabsProps {
  tabs: { id: string; title: string }[];
  activeTab: number;
  onTabChange: (index: number) => void;
}

export function FormTabs({ tabs, activeTab, onTabChange }: FormTabsProps) {
  if (tabs.length <= 1) return null;

  return (
    <div className="flex gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(index)}
          className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
            activeTab === index
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
          }`}
        >
          {tab.title}
        </button>
      ))}
    </div>
  );
}
