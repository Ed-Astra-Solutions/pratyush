/**
 * Console layout for site.json.
 *
 * Text fields are discovered from the content file itself, so any new
 * data-cms="..." hook added to the markup shows up here automatically —
 * this file only decides grouping, order and labels. Collections are
 * declared explicitly because they need typed sub-fields.
 */
window.PL_SCHEMA = {
  sections: [
    { id: 'applications', label: 'Applications', submissions: true },
    { id: 'applyform', label: 'Application form', form: true,
      groups: ['applyForm.welcome', 'applyForm.success', 'applyForm.disqualify', 'applyForm.labels', 'applyForm.meta'] },
    { id: 'hero',     label: 'Hero',        groups: ['hero', 'ticker'] },
    { id: 'problem',  label: 'The problem', groups: ['problem'] },
    { id: 'story',    label: 'Story',       groups: ['story'] },
    { id: 'system',   label: 'The system',  groups: ['system'] },
    { id: 'results',  label: 'Results',     groups: ['results'], collections: ['transformations', 'stats'] },
    { id: 'videos',   label: 'Videos',      groups: ['videos'],  collections: ['videoClips'] },
    { id: 'method',   label: 'How it works',groups: ['method'] },
    { id: 'fit',      label: 'Who it fits', groups: ['fit'] },
    { id: 'quote',    label: 'Quote',       groups: ['quote'] },
    { id: 'faq',      label: 'FAQ',         groups: ['faq'],     collections: ['faqs'] },
    { id: 'pillars',  label: 'Pillars',     groups: ['pillars'] },
    { id: 'enquiry',  label: 'Apply / CTA', groups: ['enquiry'] },
    { id: 'blog',     label: 'Blog',        groups: ['blog'],    collections: ['posts'] },
    { id: 'settings', label: 'Links & SEO', groups: ['meta', 'links', 'images', 'footer'] },
    { id: 'deploys',  label: 'Deployments', deploys: true },
  ],

  groupLabels: {
    meta: 'Page title & social preview', links: 'Links', images: 'Key images',
    hero: 'Hero', ticker: 'Scrolling ticker', problem: 'The real problem',
    story: 'Meet your coach', system: 'What every client gets', results: 'Client results',
    videos: 'Video results', method: 'How it works', fit: 'Who this fits',
    quote: 'Pull quote', faq: 'FAQ intro', pillars: 'The honest details',
    enquiry: 'Apply section', footer: 'Footer', blog: 'Blog page',
    'applyForm.welcome': 'Opening screen',
    'applyForm.success': 'Thank-you screen',
    'applyForm.disqualify': 'Screen shown when someone can\'t invest',
    'applyForm.labels': 'Buttons & messages',
    'applyForm.meta': 'Page title & search description',
  },

  /** Question types offered in the form editor. */
  stepTypes: [
    { value: 'single',  label: 'One choice (advances on click)' },
    { value: 'multi',   label: 'Multiple choice' },
    { value: 'text',    label: 'Short text answer' },
    { value: 'contact', label: 'Contact details block' },
  ],

  // Rendering hints by dotted key or key suffix.
  fieldLabels: {
    'hero.line1': 'Headline line 1', 'hero.line2': 'Headline line 2', 'hero.line3': 'Headline line 3',
    'hero.spine': 'Vertical spine text', 'hero.body': 'Sub-headline', 'hero.ctaLabel': 'Button label',
    'links.apply': 'Application form URL', 'links.instagram': 'Instagram URL',
    'links.youtube': 'YouTube URL', 'links.email': 'Email link (mailto:…)',
    'images.hero': 'Hero image', 'images.story': 'Founder portrait', 'images.banner': 'Team banner',
    'meta.title': 'Browser / search title', 'meta.description': 'Search description',
    'meta.ogTitle': 'Social share title', 'meta.ogDescription': 'Social share description',
  },

  // Fields that hold a path into frontend/images and get the upload widget.
  imageKeys: ['images.hero', 'images.story', 'images.banner'],

  collections: {
    transformations: {
      label: 'Client transformations',
      titleField: 'name',
      fields: [
        { key: 'name',  label: 'Client name', type: 'text' },
        { key: 'stat',  label: 'Result badge', type: 'text', hint: 'e.g. −31 lbs · 5 months' },
        { key: 'image', label: 'Photo', type: 'image' },
        { key: 'story', label: 'Short story', type: 'textarea' },
        { key: 'alt',   label: 'Image alt text (SEO)', type: 'textarea' },
        { key: 'title', label: 'Image title', type: 'text' },
      ],
      blank: { name: 'New client', stat: '', image: '', story: '', alt: '', title: '' },
    },
    stats: {
      label: 'Counters',
      titleField: 'label',
      fields: [
        { key: 'count',  label: 'Number', type: 'text' },
        { key: 'suffix', label: 'Suffix', type: 'text', hint: '+, %, or blank' },
        { key: 'label',  label: 'Caption', type: 'text' },
      ],
      blank: { count: '0', suffix: '', label: 'New counter' },
    },
    videoClips: {
      label: 'Video testimonials',
      titleField: 'name',
      hint: 'The section stays hidden on the site while this list is empty.',
      fields: [
        { key: 'name',  label: 'Client name', type: 'text' },
        { key: 'label', label: 'Caption', type: 'text' },
        { key: 'src',   label: 'Embed URL or uploaded file', type: 'text', hint: 'YouTube/Instagram embed URL, or an uploaded .mp4 path' },
        { key: 'type',  label: 'Kind', type: 'select', options: ['embed', 'file'] },
        { key: 'wide',  label: '16:9 (instead of vertical)', type: 'bool' },
      ],
      blank: { name: 'New clip', label: '', src: '', type: 'embed', wide: false },
    },
    faqs: {
      label: 'Questions',
      titleField: 'q',
      fields: [
        { key: 'q', label: 'Question', type: 'text' },
        { key: 'a', label: 'Answer', type: 'textarea' },
      ],
      blank: { q: 'New question', a: '' },
    },
    posts: {
      label: 'Blog cards',
      titleField: 'title',
      fields: [
        { key: 'tag',     label: 'Tag', type: 'text' },
        { key: 'title',   label: 'Title', type: 'text' },
        { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
        { key: 'url',     label: 'Link (leave blank for "Read soon")', type: 'text' },
      ],
      blank: { tag: 'Training', title: 'New post', excerpt: '', url: '' },
    },
  },
};
