import React, { useState, useEffect } from 'react';
import { scheduleDataRefresh } from '../../utils/appRefresh';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

const getTextColorForBackground = (hexColor) => {
    if (!hexColor) return '#000000';
    try {
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    } catch (e) {
        return '#000000';
    }
};

const hexToRgba = (hex, alpha = 0.1) => {
    if (!hex) return `rgba(249, 250, 251, 1)`;
    try {
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        const [r, g, b] = result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
        return `rgba(${r},${g},${b},${alpha})`;
    } catch (e) {
        return `rgba(249, 250, 251, 1)`;
    }
};

// Live preview built to match CommunityInfoCard — i.e. exactly how the community's card
// looks on a creation in the Creations view. Toggles/checklists are clickable so the admin
// can try out how each state renders.
const CardLivePreview = ({ fields, themeColor, profileImageUrl, communityName, sampleRank }) => {
    const [previewData, setPreviewData] = useState({});

    // Seed each field with a sensible sample value so the card looks populated.
    useEffect(() => {
        setPreviewData((prev) => {
            const next = {};
            fields.forEach((field) => {
                if (field.id in prev) {
                    next[field.id] = prev[field.id];
                } else if (field.type === 'toggle') {
                    next[field.id] = true;
                } else if (field.type === 'checklist') {
                    next[field.id] = (field.options || []).reduce((acc, opt, i) => ({ ...acc, [opt]: i === 0 }), {});
                } else if (field.type === 'dropdown') {
                    next[field.id] = field.options?.[0] || 'Sample';
                } else {
                    next[field.id] = 'Sample text';
                }
            });
            return next;
        });
    }, [fields]);

    const ring = themeColor || '#6B7280';

    const renderFieldValue = (field) => {
        const value = previewData[field.id];
        switch (field.type) {
            case 'textfield':
                return (
                    <p className="text-sm text-gray-800 font-medium bg-gray-100 p-2 rounded break-words w-full text-center">
                        {value || 'Sample text'}
                    </p>
                );
            case 'toggle': {
                const isActive = !!value;
                const bgColor = isActive ? (field.toggleColors?.on || '#4ADE80') : (field.toggleColors?.off || '#D1D5DB');
                const label = isActive ? (field.toggleLabels?.on || 'On') : (field.toggleLabels?.off || 'Off');
                return (
                    <button
                        type="button"
                        onClick={() => setPreviewData((p) => ({ ...p, [field.id]: !isActive }))}
                        className="text-sm font-semibold px-3 py-1 rounded-full transition-colors"
                        style={{ backgroundColor: bgColor, color: getTextColorForBackground(bgColor) }}
                        title="Click to toggle"
                    >
                        {label}
                    </button>
                );
            }
            case 'dropdown':
                return <p className="text-sm text-gray-800 font-medium">{value || 'Sample'}</p>;
            case 'checklist':
                return (
                    <ul className="space-y-1 text-left">
                        {(field.options || []).map((option) => (
                            <li key={option}>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setPreviewData((p) => ({
                                            ...p,
                                            [field.id]: { ...p[field.id], [option]: !p[field.id]?.[option] },
                                        }))
                                    }
                                    className={`text-sm ${value?.[option] ? 'text-green-600 font-semibold' : 'text-gray-400 line-through'}`}
                                >
                                    {option}
                                </button>
                            </li>
                        ))}
                        {(!field.options || field.options.length === 0) && (
                            <p className="text-xs text-gray-400">Checklist items will appear here.</p>
                        )}
                    </ul>
                );
            default:
                return null;
        }
    };

    return (
        <div>
            <h4 className="text-center font-bold text-gray-500 mb-1">Live Preview</h4>
            <p className="text-center text-xs text-gray-400 mb-4">How your card appears on a creation in Creations.</p>
            <div className="bg-white rounded-lg shadow-md flex flex-col overflow-hidden ring-4 max-w-xs mx-auto" style={{ '--tw-ring-color': ring }}>
                <div className="w-full p-4 flex flex-col items-center text-center" style={{ backgroundColor: hexToRgba(ring) }}>
                    <img
                        src={profileImageUrl || 'https://placehold.co/96x96/e2e8f0/64748b?text=C'}
                        alt="Community profile"
                        className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md mb-2"
                    />
                    <h4 className="font-bold text-lg text-gray-800 break-all">{communityName || 'Your Community'}</h4>
                    <div className="mt-3 pt-3 border-t w-full">
                        <p className="text-xs font-semibold text-gray-500 mb-2">Creator's Ranks</p>
                        <div className="flex flex-wrap gap-1 justify-center">
                            <span
                                className="text-xs font-semibold px-2 py-1 rounded-full capitalize"
                                style={{ backgroundColor: sampleRank.color, color: getTextColorForBackground(sampleRank.color) }}
                            >
                                {sampleRank.name}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="w-full p-4 flex flex-col items-center border-t">
                    <div className="space-y-3 w-full max-w-xs">
                        {fields.map((field) => (
                            <div key={field.id} className="text-center">
                                <p className="text-sm font-bold text-gray-600">{field.label || `(Untitled ${field.type})`}</p>
                                <div className="mt-1 flex justify-center">{renderFieldValue(field)}</div>
                            </div>
                        ))}
                        {fields.length === 0 && (
                            <p className="text-sm text-gray-400 text-center">Your custom fields will be previewed here.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const FieldEditor = ({ field, onUpdate, onRemove, provided }) => {
    const [optionInput, setOptionInput] = useState('');

    const handleLabelChange = (e) => {
        onUpdate(field.id, { ...field, label: e.target.value });
    };

    const handleToggleLabelChange = (side, value) => {
        onUpdate(field.id, { ...field, toggleLabels: { ...field.toggleLabels, [side]: value } });
    };

    const handleToggleColorChange = (side, value) => {
        onUpdate(field.id, { ...field, toggleColors: { ...field.toggleColors, [side]: value } });
    };

    const handleIsCopyableChange = (e) => {
        onUpdate(field.id, { ...field, isCopyable: e.target.checked });
    };

    const handleAddOption = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const newOption = optionInput.trim();
            if (newOption && !field.options?.includes(newOption)) {
                const newOptions = [...(field.options || []), newOption];
                onUpdate(field.id, { ...field, options: newOptions });
            }
            setOptionInput('');
        }
    };

    const handleRemoveOption = (optionToRemove) => {
        const newOptions = field.options.filter((opt) => opt !== optionToRemove);
        onUpdate(field.id, { ...field, options: newOptions });
    };

    const ICONS_MAP = {
        textfield: ICONS.pencil,
        checklist: ICONS.checklist,
        dropdown: ICONS.chevronDown,
        toggle: ICONS.toggle,
    };

    return (
        <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            className="p-4 bg-gray-100 rounded-lg border"
        >
            <div className="flex items-center gap-3 mb-3">
                <div {...provided.dragHandleProps} className="cursor-grab text-gray-400">
                    <Icon path={ICONS.dragHandle} className="w-5 h-5" />
                </div>
                <div className="flex items-center text-gray-500 flex-shrink-0">
                    <Icon path={ICONS_MAP[field.type] || ICONS.pencil} className="w-5 h-5 mr-2" />
                    <span className="font-bold capitalize">{field.type}</span>
                </div>
                <button
                    onClick={() => onRemove(field.id)}
                    className="ml-auto p-2 bg-red-100 text-red-600 hover:bg-red-200 rounded-full flex-shrink-0"
                    title="Remove field"
                >
                    <Icon path={ICONS.trash} className="w-5 h-5" />
                </button>
            </div>
            <div className="space-y-2">
                <input
                    type="text"
                    value={field.label}
                    onChange={handleLabelChange}
                    placeholder="Enter a label for this field..."
                    className="w-full p-2 border rounded-md"
                />
                {field.type === 'textfield' && (
                    <label className="flex items-center text-sm text-gray-600 pt-1">
                        <input
                            type="checkbox"
                            checked={!!field.isCopyable}
                            onChange={handleIsCopyableChange}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2">Make text copyable on click</span>
                    </label>
                )}
                {(field.type === 'dropdown' || field.type === 'checklist') && (
                    <>
                        <input
                            type="text"
                            value={optionInput}
                            onChange={(e) => setOptionInput(e.target.value)}
                            onKeyDown={handleAddOption}
                            placeholder="Add an item and press Enter..."
                            className="w-full p-2 border rounded-md text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                            {field.options?.map((opt) => (
                                <div key={opt} className="flex items-center bg-gray-300 text-gray-800 text-xs font-medium px-2 py-1 rounded-full">
                                    <span>{opt}</span>
                                    <button onClick={() => handleRemoveOption(opt)} className="ml-2 text-red-500 hover:text-red-700 font-bold">&times;</button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
                {field.type === 'toggle' && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                        <input
                            type="text"
                            value={field.toggleLabels?.off || ''}
                            onChange={(e) => handleToggleLabelChange('off', e.target.value)}
                            placeholder="'Off' Label"
                            className="p-2 border rounded-md text-sm"
                        />
                        <input
                            type="text"
                            value={field.toggleLabels?.on || ''}
                            onChange={(e) => handleToggleLabelChange('on', e.target.value)}
                            placeholder="'On' Label"
                            className="p-2 border rounded-md text-sm"
                        />
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={field.toggleColors?.off || '#D1D5DB'}
                                onChange={(e) => handleToggleColorChange('off', e.target.value)}
                                className="w-10 h-10 p-1 border rounded-lg cursor-pointer"
                            />
                            <span className="text-xs text-gray-500">'Off' Color</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={field.toggleColors?.on || '#4ADE80'}
                                onChange={(e) => handleToggleColorChange('on', e.target.value)}
                                className="w-10 h-10 p-1 border rounded-lg cursor-pointer"
                            />
                            <span className="text-xs text-gray-500">'On' Color</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const CommunityCardEditor = ({ community, setModalMessage, previewThemeColor, previewProfileImageUrl }) => {
    const [fields, setFields] = useState(community.customCreationFields || []);
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [loading, setLoading] = useState(false);

    // A representative rank for the preview: the community's default rank, else the first
    // custom rank, else a plain "Member" chip.
    const customRanks = (community.ranks || []).filter((r) => r.name !== 'Owner' && r.name !== 'Moderator');
    const sampleRank =
        customRanks.find((r) => r.name === community.defaultRankName) ||
        customRanks[0] || { name: 'Member', color: '#6B7280' };

    const onDragEnd = (result) => {
        if (!result.destination) return;
        const items = Array.from(fields);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        setFields(items);
    };

    const addField = (type) => {
        if (fields.length >= 5) {
            setModalMessage('You can add a maximum of 5 custom fields.');
            return;
        }
        const newField = {
            id: `field_${Date.now()}`,
            type,
            label: '',
            ...(type === 'textfield' && { isCopyable: false }),
            ...(type === 'dropdown' && { options: [] }),
            ...(type === 'checklist' && { options: [] }),
            ...(type === 'toggle' && {
                toggleLabels: { off: 'Off', on: 'On' },
                toggleColors: { off: '#D1D5DB', on: '#4ADE80' },
            }),
        };
        setFields([...fields, newField]);
        setShowAddMenu(false);
    };

    const updateField = (id, updatedField) => {
        setFields(fields.map((f) => (f.id === id ? updatedField : f)));
    };

    const removeField = (id) => {
        setFields(fields.filter((f) => f.id !== id));
    };

    const handleSaveChanges = async () => {
        setLoading(true);
        try {
            const communityRef = doc(db, 'communitys', community.id);
            await updateDoc(communityRef, { customCreationFields: fields });
            setModalMessage('Custom card fields saved successfully!');
            scheduleDataRefresh();
        } catch (error) {
            setModalMessage(`Error saving fields: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-md p-6 sm:p-8">
            <div className="mb-6">
                <h3 className="text-2xl font-bold text-gray-800">Creation Card</h3>
                <p className="text-sm text-gray-500 mt-1">
                    Add optional fields that members fill in when they submit a creation to your community. These
                    appear on the creation's community card in the Creations view, exactly as shown in the live
                    preview.
                </p>
                <div className="mt-3 p-3 bg-blue-50 border-l-4 border-blue-400 text-blue-800 rounded-r-lg text-sm">
                    Drag the handle to reorder fields. You can add up to 5. Text fields can be made click-to-copy;
                    toggles and checklists let you define their own labels and colors.
                </div>
            </div>

            <div className="xl:flex xl:gap-8 xl:items-start">
                {/* Editor */}
                <div className="xl:flex-1 min-w-0">
                    <DragDropContext onDragEnd={onDragEnd}>
                        <Droppable droppableId="fields">
                            {(provided) => (
                                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-4 mb-6">
                                    {fields.map((field, index) => (
                                        <Draggable key={field.id} draggableId={field.id} index={index}>
                                            {(prov) => (
                                                <FieldEditor
                                                    field={field}
                                                    onUpdate={updateField}
                                                    onRemove={removeField}
                                                    provided={prov}
                                                />
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                    {fields.length === 0 && (
                                        <p className="text-center text-gray-400 py-6 border-2 border-dashed rounded-lg">
                                            No custom fields yet. Add one below to get started.
                                        </p>
                                    )}
                                </div>
                            )}
                        </Droppable>
                    </DragDropContext>

                    <div className="flex justify-center items-center gap-4">
                        <div className="relative">
                            <button
                                onClick={() => setShowAddMenu(!showAddMenu)}
                                disabled={fields.length >= 5}
                                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 flex items-center"
                            >
                                <Icon path={ICONS.plus} className="w-5 h-5 mr-2" />
                                Add Field ({fields.length}/5)
                            </button>
                            {showAddMenu && (
                                <div className="absolute bottom-full mb-2 w-48 bg-white rounded-md shadow-lg border z-10">
                                    <button onClick={() => addField('textfield')} className="w-full text-left flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                                        <Icon path={ICONS.pencil} className="w-4 h-4 mr-3" /> Text Field
                                    </button>
                                    <button onClick={() => addField('checklist')} className="w-full text-left flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                                        <Icon path={ICONS.checklist} className="w-4 h-4 mr-3" /> Checklist
                                    </button>
                                    <button onClick={() => addField('dropdown')} className="w-full text-left flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                                        <Icon path={ICONS.chevronDown} className="w-4 h-4 mr-3" /> Dropdown
                                    </button>
                                    <button onClick={() => addField('toggle')} className="w-full text-left flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                                        <Icon path={ICONS.toggle} className="w-4 h-4 mr-3" /> Toggle
                                    </button>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={handleSaveChanges}
                            disabled={loading}
                            className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-lg disabled:opacity-50"
                        >
                            {loading ? <Spinner /> : 'Save Card Fields'}
                        </button>
                    </div>
                </div>

                {/* Live preview — beside on xl, below on smaller screens */}
                <div className="mt-8 xl:mt-0 xl:w-80 xl:flex-shrink-0 xl:sticky xl:top-4">
                    <CardLivePreview
                        fields={fields}
                        themeColor={previewThemeColor || community.themeColor}
                        profileImageUrl={previewProfileImageUrl || community.profileImageUrl}
                        communityName={community.name}
                        sampleRank={sampleRank}
                    />
                </div>
            </div>
        </div>
    );
};

export default CommunityCardEditor;
