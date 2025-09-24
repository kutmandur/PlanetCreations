import React, { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

const CardPreview = ({ fields }) => {
    const [previewData, setPreviewData] = useState({});

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
    
    const hexToRgba = (hex, alpha = 0.3) => {
        if (!hex) return `rgba(209, 213, 219, ${alpha})`;
        try {
            const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
            return `rgba(${r},${g},${b},${alpha})`;
        } catch (e) {
            return `rgba(209, 213, 219, ${alpha})`;
        }
    };

    useEffect(() => {
        const initialData = {};
        fields.forEach(field => {
            if (field.type === 'toggle') {
                initialData[field.id] = false;
            } else if (field.type === 'checklist') {
                initialData[field.id] = {};
            } else {
                initialData[field.id] = '';
            }
        });
        setPreviewData(initialData);
    }, [fields]);
    
    const handlePreviewChange = (fieldId, type, value, option) => {
        setPreviewData(prev => {
            if (type === 'checklist') {
                return {
                    ...prev,
                    [fieldId]: {
                        ...prev[fieldId],
                        [option]: value
                    }
                };
            }
            return { ...prev, [fieldId]: value };
        });
    };

    return (
        <div className="mt-4 p-4 border-2 border-dashed rounded-lg">
            <h4 className="text-center font-bold text-gray-500 mb-4">Live Preview</h4>
            <div className="bg-white p-4 rounded-lg shadow-inner space-y-4">
                {fields.map(field => (
                    <div key={field.id} className="flex flex-col items-center">
                        <label className="block text-sm font-bold text-gray-700 mb-2 w-full text-center">{field.label || `(Untitled ${field.type})`}</label>
                        {field.type === 'textfield' && (
                            <input 
                                type="text" 
                                className="w-full max-w-xs p-2 border rounded-md bg-gray-50" 
                                placeholder="User will enter text here..." 
                                value={previewData[field.id] || ''}
                                onChange={(e) => handlePreviewChange(field.id, 'textfield', e.target.value)}
                            />
                        )}
                        {field.type === 'toggle' && (
                            <div 
                                onClick={() => handlePreviewChange(field.id, 'toggle', !previewData[field.id])}
                                className="relative w-40 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300"
                                style={{ backgroundColor: hexToRgba(previewData[field.id] ? field.toggleColors?.on : field.toggleColors?.off) }}
                            >
                                <div 
                                    className={`absolute h-8 w-1/2 rounded-full shadow-md transform transition-transform duration-300`}
                                    style={{ 
                                        backgroundColor: previewData[field.id] ? (field.toggleColors?.on || '#4ADE80') : (field.toggleColors?.off || '#D1D5DB'),
                                        transform: previewData[field.id] ? 'translateX(100%)' : 'translateX(0%)'
                                    }}
                                ></div>
                                <span 
                                    className="w-1/2 text-center z-10 text-sm font-semibold px-1" 
                                    style={{ color: getTextColorForBackground(field.toggleColors?.off) }}
                                >
                                    {field.toggleLabels?.off || 'Off'}
                                </span>
                                <span 
                                    className="w-1/2 text-center z-10 text-sm font-semibold px-1"
                                    style={{ color: getTextColorForBackground(field.toggleColors?.on) }}
                                >
                                    {field.toggleLabels?.on || 'On'}
                                </span>
                            </div>
                        )}
                        {field.type === 'dropdown' && (
                            <select 
                                className="w-full max-w-xs p-2 border rounded-md bg-gray-50"
                                value={previewData[field.id] || ''}
                                onChange={(e) => handlePreviewChange(field.id, 'dropdown', e.target.value)}
                            >
                                <option value="">Select an option...</option>
                                {field.options?.map(opt => <option key={opt}>{opt}</option>)}
                            </select>
                        )}
                        {field.type === 'checklist' && (
                            <div className="space-y-2 w-full max-w-xs">
                                {field.options?.map(opt => (
                                    <label key={opt} className="flex items-center text-gray-700">
                                        <input 
                                            type="checkbox" 
                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                                            checked={!!previewData[field.id]?.[opt]}
                                            onChange={(e) => handlePreviewChange(field.id, 'checklist', e.target.checked, opt)}
                                        />
                                        <span className="ml-2">{opt}</span>
                                    </label>
                                ))}
                                {(!field.options || field.options.length === 0) && <p className="text-xs text-gray-400">Checklist items will appear here.</p>}
                            </div>
                        )}
                    </div>
                ))}
                {fields.length === 0 && <p className="text-center text-gray-400">Your custom fields will be previewed here.</p>}
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
        const newOptions = field.options.filter(opt => opt !== optionToRemove);
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
            className="p-4 bg-gray-100 rounded-lg border flex items-start sm:items-center gap-4"
        >
            <div {...provided.dragHandleProps} className="cursor-grab text-gray-400 p-2 self-center">
                <Icon path={ICONS.dragHandle} className="w-5 h-5" />
            </div>
            <div className="flex items-center text-gray-500 flex-shrink-0 self-center">
                <Icon path={ICONS_MAP[field.type] || ICONS.pencil} className="w-6 h-6 mr-3" />
                <span className="font-bold capitalize">{field.type}</span>
            </div>
            <div className="flex-grow w-full space-y-2">
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
                            {field.options?.map(opt => (
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
            <div className="flex items-center gap-2 self-center">
                <button onClick={() => onRemove(field.id)} className="p-2 bg-red-100 text-red-600 hover:bg-red-200 rounded-full">
                    <Icon path={ICONS.trash} className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};

const CommunityCardEditor = ({ community, setModalMessage }) => {
    const [fields, setFields] = useState(community.customCreationFields || []);
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [loading, setLoading] = useState(false);

    const onDragEnd = (result) => {
        if (!result.destination) return;
        const items = Array.from(fields);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        setFields(items);
    };

    const addField = (type) => {
        if (fields.length >= 5) {
            setModalMessage("You can add a maximum of 5 custom fields.");
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
                toggleColors: { off: '#D1D5DB', on: '#4ADE80' }
            }),
        };
        setFields([...fields, newField]);
        setShowAddMenu(false);
    };

    const updateField = (id, updatedField) => {
        setFields(fields.map(f => f.id === id ? updatedField : f));
    };

    const removeField = (id) => {
        setFields(fields.filter(f => f.id !== id));
    };

    const handleSaveChanges = async () => {
        setLoading(true);
        try {
            const communityRef = doc(db, 'communitys', community.id);
            await updateDoc(communityRef, {
                customCreationFields: fields
            });
            setModalMessage("Custom card fields saved successfully!");
        } catch (error) {
            setModalMessage(`Error saving fields: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-2 text-center">Community Card Editor</h2>
            <p className="text-center text-gray-600 mb-6">Drag and drop to reorder fields.</p>

            <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="fields">
                    {(provided) => (
                        <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-4 mb-6">
                            {fields.map((field, index) => (
                                <Draggable key={field.id} draggableId={field.id} index={index}>
                                    {(provided) => (
                                        <FieldEditor 
                                            field={field} 
                                            onUpdate={updateField} 
                                            onRemove={removeField}
                                            provided={provided}
                                        />
                                    )}
                                </Draggable>
                            ))}
                            {provided.placeholder}
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
                    {loading ? <Spinner /> : 'Save Changes'}
                </button>
            </div>
            
            <CardPreview fields={fields} />
        </div>
    );
};

export default CommunityCardEditor;